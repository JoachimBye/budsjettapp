// auth-helpers.js

/**
 * Bygger en localStorage-nøkkel som er knyttet til innlogget bruker.
 * Hvis vi ikke har session (teoretisk) faller vi tilbake til "global" nøkkel.
 */
function keyFor(base, session) {
  const id = session?.user?.id;
  return id ? `${base}_${id}` : base;
}

const GLOBAL_KEYS_TO_CLEAR = [
  'pending_invite',
  'trackingScope',
  'weeklyBudget',
  'householdCount',
  'activeWeekISO',
  'budget_total',
  'purchase_categories_v1',
  'purchase_stores_v1',
  'frequentItems',
];

const GLOBAL_KEY_PREFIXES = [
  'weeklyBudget_',
  'purchases_',
  'shoppingList_',
  'shoppingList_inbox_',
  'weeklyMenu_',
  'purchase_categories_cache_v2',
  'purchase_stores_cache_v2',
  'shopping_list_cache_v2',
  'weekly_menu_cache_v1',
];

/**
 * Henter den sanne onboarding-statusen for DENNE brukeren.
 * Prioriterer "setupComplete" (gullflagget per bruker), deretter databasen,
 * og til slutt lokal lagring som en fallback.
 */
async function getOnboardingStatus(supa, session) {
  const setupKey = keyFor('setupComplete', session);
  const onboardingKey = keyFor('onboarding_done', session);

  // 1. Gullflagget per bruker: hvis dette er satt, er brukeren 100 % klar for appen.
  if (localStorage.getItem(setupKey) === 'true') {
    return { isSetupComplete: true, isOnboardingDone: true };
  }

  // 2. Prøv databasen (members.onboarding_done)
  let dbOnboardingDone = false;
  try {
    const { data: member, error } = await supa
      .from('members')
      .select('onboarding_done')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (!error && member && member.onboarding_done) {
      dbOnboardingDone = true;
      // Synk til localStorage per bruker for sikkerhets skyld
      localStorage.setItem(onboardingKey, '1');
    }
  } catch (e) {
    console.error('Klarte ikke hente medlemsstatus fra DB', e);
    // Fallback til localStorage hvis DB feiler
  }

  // 3. Fallback: localStorage flagg per bruker
  const localOnboardingDone = localStorage.getItem(onboardingKey) === '1';

  return {
    isSetupComplete: false,
    isOnboardingDone: dbOnboardingDone || localOnboardingDone,
  };
}

/**
 * Ny "hjerne" for all ruting.
 * Kalles på HVER side som trenger auth (index, onboarding1–3, takk, app, add-purchase, osv.).
 */
async function protectPage(supa) {
  const currentPath = window.location.pathname;
  const { data: { session } } = await supa.auth.getSession();

  // --- 1. UTLOGGET bruker ---
  if (!session) {
    // Hvis brukeren ikke er på innloggingssiden → send dit
    if (currentPath !== '/innlogging.html') {
      window.location.href = '/innlogging.html';
    }
    // Hvis de allerede er på innlogging.html → gjør ingenting
    return;
  }

  // --- 2. INNLOGGET bruker ---
  const status = await getOnboardingStatus(supa, session);

  // 2a. Bruker er på /innlogging.html men HAR sesjon → send bort
  if (currentPath === '/innlogging.html') {
    if (status.isSetupComplete) {
      window.location.href = '/app.html';
    } else if (status.isOnboardingDone) {
      window.location.href = '/takk.html';
    } else {
      window.location.href = '/index.html'; // start onboarding
    }
    return;
  }

  // 2b. Ferdig med alt (setupComplete = true)
  if (status.isSetupComplete) {
    const appPaths = [
      '/app.html',
      '/add-purchase.html',
      '/week-report.html',
      '/handleliste.html',
      '/middag.html',
      '/settings.html',       // innstillinger / settings-side
      '/innstillinger.html',  // hvis du bruker norsk filnavn
    ];
    if (!appPaths.includes(currentPath)) {
      // Innlogget + ferdig, men på "rar" side → rett til app
      window.location.href = '/app.html';
    }
    // Hvis de allerede er på en gyldig app-side → gjør ingenting
    return;
  }

  // 2c. Onboarding trinn ferdig, men "Start uke 1" ikke trykket ennå
  if (status.isOnboardingDone) {
    if (currentPath !== '/takk.html') {
      window.location.href = '/takk.html';
    }
    return; // Hvis de er på /takk.html → gjør ingenting
  }

  // 2d. Midt i onboarding (ingen flagg ferdig)
  const onboardingPaths = [
    '/index.html',
    '/onboarding1.html',
    '/onboarding2.html',
    '/onboarding3.html',
    '/takk.html', // regnes som del av onboarding-flyten
  ];
  if (!onboardingPaths.includes(currentPath)) {
    // Innlogget, ikke ferdig med onboarding, men på feil side → send til start
    window.location.href = '/index.html';
  }
  // Hvis de er på en gyldig onboarding-side → la dem være der
}

/**
 * Robust utlogging:
 * 1. Logger ut fra Supabase.
 * 2. RYDDER KUN trygge, midlertidige nøkler i localStorage.
 * 3. Lar onboarding-/budsjettdata for brukere leve videre mellom innlogginger.
 */
async function handleLogout(supa) {
  try {
    const { error } = await supa.auth.signOut();
    if (error) {
      console.error('Feil ved utlogging:', error);
    }
  } catch (e) {
    console.error('Feil under utlogging:', e);
  } finally {
    // Fjern globale nøkler som ikke er knyttet til en spesifikk bruker.
    // Per bruker beholdes alle nøkler som ender med "_<userId>".
    Object.keys(localStorage).forEach((key) => {
      if (GLOBAL_KEYS_TO_CLEAR.includes(key)) {
        localStorage.removeItem(key);
        return;
      }
      if (GLOBAL_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    });

    if (window.householdContext?.clearCache) {
      window.householdContext.clearCache();
    }

    window.location.href = '/innlogging.html';
  }
}

/**
 * Lytter etter ekstern utlogging (f.eks. token utløpt).
 * Rydder IKKE localStorage – den bare sender til innlogging.
 * Bruk `handleLogout` for "bevisst" utlogging via knapp.
 */
function initializeAuthListener(supa) {
  supa.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      if (window.location.pathname !== '/innlogging.html') {
        window.location.href = '/innlogging.html';
      }
    }
  });
}

// Gjør tilgjengelig globalt
window.authHelpers = {
  protectPage,
  handleLogout,
  initializeAuthListener,
};
