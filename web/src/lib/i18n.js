const stored = (() => {
  try {
    return localStorage.getItem("orbit.lang");
  } catch {
    return null;
  }
})();

export const LANG = stored == "fr" ? "fr" : "en";
document.documentElement.lang = LANG;

export function setLang(lang) {
  try {
    localStorage.setItem("orbit.lang", lang);
  } catch {}
  location.reload();
}

export const t = (fr, en) => (LANG == "fr" ? fr : en ?? fr);

const ERRORS = {
  fr: {
    invalid_credentials: "Identifiant ou mot de passe incorrect.", invalid_credentials_or_code: "Mot de passe ou code incorrect.",
    too_many_attempts: "Trop de tentatives. Réessaie dans quelques minutes.", rate_limited: "Doucement : réessaie dans un instant.",
    username_taken: "Ce pseudo est déjà pris.", username_reserved: "Ce pseudo est réservé.", username_format: "3 à 24 caractères : lettres, chiffres, _ . -",
    email_format: "Adresse e-mail invalide.", password_short: "10 caractères minimum.", password_long: "256 caractères maximum.",
    password_personal: "N'utilise pas ton pseudo ou ton e-mail dans le mot de passe.", password_weak: "Mot de passe trop simple.",
    terms_required: "Accepte les conditions pour continuer.", token_invalid: "Ce lien est expiré ou a déjà servi.", captcha_failed: "Vérification anti-robot échouée.",
    account_suspended: "Ce compte est suspendu.", mfa_required: "Entre ton code de validation.", invalid_code: "Code incorrect.",
    reauth_required: "Confirme ton mot de passe pour continuer.", email_unverified: "Confirme d'abord ton adresse e-mail.",
    forbidden: "Tu n'as pas l'autorisation de faire ça.", unauthenticated: "Connecte-toi pour continuer.", not_found: "Introuvable.",
    request_unavailable: "Impossible d'envoyer une demande à ce membre.", request_exists: "Une demande est déjà en cours.", already_friends: "Vous êtes déjà amis.",
    social_suspended: "Tes fonctions communautaires sont suspendues pour le moment.", social_disabled: "Tu as désactivé les fonctions sociales.",
    sharing_disabled: "Active d'abord le partage de sites dans ta confidentialité.", domain_invalid: "Nom de domaine invalide.",
    domain_sensitive: "Ce site est protégé : il ne peut pas être partagé.", url_invalid: "Lien invalide (http ou https uniquement).",
    donations_not_configured: "Les paiements ne sont pas encore ouverts.", amount_invalid: "Montant invalide.", payment_provider_error: "Le service de paiement ne répond pas.",
    file_type: "Image PNG, JPEG, WebP ou GIF uniquement.", file_too_large: "Image trop lourde.", report_exists: "Tu as déjà signalé cet élément.",
    badge_protected: "Ce badge est protégé.", badge_official: "Badge officiel : réservé au propriétaire.", already_has_badge: "Ce membre a déjà ce badge.",
    badge_not_held: "Ce membre n'a pas ce badge.", rank_too_low: "Ton rôle ne permet pas d'agir sur ce compte.", not_on_self: "Impossible sur ton propre compte.",
    confirm_mismatch: "Le pseudo ne correspond pas.", owner_cannot_delete: "Le compte propriétaire ne peut pas être supprimé.",
    mfa_unavailable: "La validation en deux étapes n'est pas encore configurée sur le serveur.", csrf: "Requête refusée.",
    invalid_input: "Vérifie les champs.", server_error: "Erreur du serveur. Réessaie.", network: "Connexion au serveur impossible.",
    email_in_use: "Un compte non confirmé utilise cette adresse. Connecte-toi avec ton mot de passe, ou réinitialise-le.",
    mozilla_already_linked: "Ce compte Orbit est déjà lié à un autre compte Mozilla.", mozilla_token_invalid: "Connexion Mozilla refusée. Reconnecte-toi à Firefox Sync.",
    mozilla_unreachable: "Les serveurs Mozilla ne répondent pas. Réessaie.", no_password: "Ton compte n'a pas de mot de passe : reconnecte-toi à Firefox Sync dans Orbit pour confirmer.",
    mod_unsafe: "Le mod n'a pas passé les vérifications.", zip_invalid: "Ce fichier n'est pas un .zip valide.", zip_too_many_files: "Trop de fichiers dans le .zip.",
    zip_encrypted: "Les .zip protégés par mot de passe ne sont pas acceptés.", zip_unsupported: "Format de compression non pris en charge.", file_too_big: "Fichier trop lourd.",
    files_missing: "Ajoute le .zip de ton mod.", zen_link_invalid: "Lien de mod Zen invalide.", zen_mod_not_found: "Ce mod Zen est introuvable.", zen_unreachable: "Le site de Zen ne répond pas.",
    version_exists: "Cette version existe déjà : change le numéro.", version_invalid: "Numéro de version invalide.", name_invalid: "Nom invalide.",
    note_required: "Une note est obligatoire pour refuser.", images_required: "Ajoute au moins une capture du mod.", too_many_images: "6 images au maximum.",
    not_pending: "Cette version a déjà été traitée.", mod_removed: "Ce mod a été retiré par l'équipe.", text_long: "Texte trop long.",
    beta_owned: "Tu as déjà accès à la bêta.", beta_free: "La bêta est gratuite en ce moment.", reason_required: "Indique un motif.",
  },
  en: {
    invalid_credentials: "Wrong login or password.", invalid_credentials_or_code: "Wrong password or code.",
    too_many_attempts: "Too many attempts. Try again in a few minutes.", rate_limited: "Slow down: try again in a moment.",
    username_taken: "This username is taken.", username_reserved: "This username is reserved.", username_format: "3 to 24 characters: letters, digits, _ . -",
    email_format: "Invalid e-mail address.", password_short: "At least 10 characters.", password_long: "256 characters at most.",
    password_personal: "Don't use your username or e-mail in the password.", password_weak: "Password too simple.",
    terms_required: "Accept the terms to continue.", token_invalid: "This link has expired or was already used.", captcha_failed: "Bot check failed.",
    account_suspended: "This account is suspended.", mfa_required: "Enter your verification code.", invalid_code: "Wrong code.",
    reauth_required: "Confirm your password to continue.", email_unverified: "Confirm your e-mail address first.",
    forbidden: "You are not allowed to do that.", unauthenticated: "Sign in to continue.", not_found: "Not found.",
    request_unavailable: "You can't send a request to this member.", request_exists: "A request is already pending.", already_friends: "You are already friends.",
    social_suspended: "Your community features are suspended for now.", social_disabled: "You turned social features off.",
    sharing_disabled: "Turn on site sharing in your privacy settings first.", domain_invalid: "Invalid domain name.",
    domain_sensitive: "This site is protected: it can't be shared.", url_invalid: "Invalid link (http or https only).",
    donations_not_configured: "Payments are not open yet.", amount_invalid: "Invalid amount.", payment_provider_error: "The payment service is not answering.",
    file_type: "PNG, JPEG, WebP or GIF images only.", file_too_large: "Image too large.", report_exists: "You already reported this.",
    badge_protected: "This badge is protected.", badge_official: "Official badge: owner only.", already_has_badge: "This member already has this badge.",
    badge_not_held: "This member doesn't have this badge.", rank_too_low: "Your role can't act on this account.", not_on_self: "Not on your own account.",
    confirm_mismatch: "The username doesn't match.", owner_cannot_delete: "The owner account can't be deleted.",
    mfa_unavailable: "Two-step verification is not set up on the server yet.", csrf: "Request refused.",
    invalid_input: "Check the fields.", server_error: "Server error. Try again.", network: "Can't reach the server.",
    email_in_use: "An unconfirmed account uses this address. Sign in with your password, or reset it.",
    mozilla_already_linked: "This Orbit account is already linked to another Mozilla account.", mozilla_token_invalid: "Mozilla sign-in refused. Sign in to Firefox Sync again.",
    mozilla_unreachable: "Mozilla's servers are not answering. Try again.", no_password: "Your account has no password: sign in to Firefox Sync in Orbit again to confirm.",
    mod_unsafe: "The mod did not pass the checks.", zip_invalid: "This file is not a valid .zip.", zip_too_many_files: "Too many files in the .zip.",
    zip_encrypted: "Password-protected .zip files are not accepted.", zip_unsupported: "Unsupported compression format.", file_too_big: "File too large.",
    files_missing: "Add your mod's .zip.", zen_link_invalid: "Invalid Zen mod link.", zen_mod_not_found: "This Zen mod was not found.", zen_unreachable: "Zen's site is not answering.",
    version_exists: "This version already exists: change the number.", version_invalid: "Invalid version number.", name_invalid: "Invalid name.",
    note_required: "A note is required to reject.", images_required: "Add at least one screenshot of the mod.", too_many_images: "6 pictures at most.",
    not_pending: "This version was already handled.", mod_removed: "This mod was removed by the team.", text_long: "Text too long.",
    beta_owned: "You already have beta access.", beta_free: "The beta is free right now.", reason_required: "Add a reason.",
  },
};

export const errorText = code => ERRORS[LANG][code] ?? ERRORS[LANG].server_error;
