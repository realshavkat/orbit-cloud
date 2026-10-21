// Terms of use and privacy policy (short, plain language).
import { h, t } from "../lib.js";

const doc = (title, updated, sections) => h("article", { class: "card legal", style: { maxWidth: "760px", margin: "0 auto" } },
  h("h1", {}, title), h("p", { class: "faint small" }, updated),
  ...sections.flatMap(([title, ...paras]) => [h("h2", {}, title), ...paras.map(p => (Array.isArray(p) ? h("ul", {}, p.map(x => h("li", {}, x))) : h("p", {}, p)))]));

export function terms() {
  return doc(t("Conditions d'utilisation", "Terms of use"), t("Version du 21 octobre 2026", "Version of 21 October 2026"), [
    [t("Le service", "The service"), t("Le compte Orbit donne accès à la communauté : profil, badges, amis, collections. Il est facultatif : toutes les fonctions du navigateur Orbit restent gratuites et utilisables sans compte.",
      "An Orbit account gives access to the community: profile, badges, friends, collections. It is optional: every feature of the Orbit browser stays free and usable without an account.")],
    [t("Ton compte", "Your account"), t("Un compte par personne. Tu es responsable de ton mot de passe ; active la validation en deux étapes. Un pseudo qui imite Orbit, son équipe ou une autre personne est interdit.",
      "One account per person. You are responsible for your password; turn on two-step verification. A username imitating Orbit, its team or another person is forbidden.")],
    [t("Contenu", "Content"), t("Interdits : harcèlement, spam, contenu illégal, haineux ou sexuel explicite, usurpation d'identité. Les modérateurs peuvent masquer un contenu, suspendre les fonctions communautaires ou un compte ; tu peux contester une décision depuis ton compte.",
      "Forbidden: harassment, spam, illegal, hateful or sexually explicit content, impersonation. Moderators may hide content or suspend community features or an account; you can appeal a decision from your account.")],
    [t("Badges", "Badges"), t("Les badges récompensent des critères réels. Ils ne s'achètent pas, ne se transfèrent pas et ne donnent aucun droit. L'équipe peut retirer un badge obtenu à tort, avec un motif.",
      "Badges reward real criteria. They cannot be bought or transferred and grant no rights. The team may remove a badge earned by mistake, with a reason.")],
    [t("Dons", "Donations"), t("Les dons sont volontaires et ne débloquent aucune fonction. Le soutien mensuel s'arrête à tout moment. Un remboursement peut être demandé sous 14 jours ; un don remboursé ou contesté ne compte plus pour les badges.",
      "Donations are voluntary and unlock no feature. Monthly support can stop at any time. A refund can be requested within 14 days; a refunded or disputed donation no longer counts toward badges.")],
    [t("Fin du compte", "Closing your account"), t("Tu peux supprimer ton compte à tout moment. Orbit peut suspendre un compte qui enfreint ces conditions.", "You can delete your account at any time. Orbit may suspend an account that breaks these terms.")],
  ]);
}

export function privacy() {
  return doc(t("Politique de confidentialité", "Privacy policy"), t("Version du 21 octobre 2026", "Version of 21 October 2026"), [
    [t("Ce que nous collectons", "What we collect"), [
      t("Compte : pseudo, adresse e-mail, mot de passe (haché avec Argon2id, jamais lisible).", "Account: username, e-mail address, password (hashed with Argon2id, never readable)."),
      t("Profil : ce que tu y écris et les images que tu envoies.", "Profile: what you write and the images you upload."),
      t("Sécurité : sessions (adresse IP, navigateur), tentatives de connexion (30 jours).", "Security: sessions (IP address, browser), sign-in attempts (30 days)."),
      t("Communauté : amis, blocages, signalements, notifications, sites et collections que tu partages.", "Community: friends, blocks, reports, notifications, sites and collections you share."),
      t("Dons : montant, date, statut et références Stripe. Jamais ta carte bancaire.", "Donations: amount, date, status and Stripe references. Never your card."),
    ]],
    [t("Ce que nous ne collectons pas", "What we don't collect"), t("Ni ton historique, ni tes onglets, ni tes favoris, ni ta navigation privée. Le navigateur n'envoie un site que si tu cliques sur « Partager ce site » : seulement son nom de domaine.",
      "Not your history, tabs, bookmarks or private browsing. The browser sends a site only when you click \"Share this site\": just its domain name.")],
    [t("Visibilité", "Visibility"), t("Chaque élément de ton profil a son réglage de visibilité, appliqué par le serveur. L'adresse e-mail n'est jamais publique. Un site partagé n'affiche ses membres qu'à partir de trois personnes.",
      "Each part of your profile has its own visibility setting, enforced by the server. Your e-mail is never public. A shared site only lists its members from three people.")],
    [t("Durées de conservation", "Retention"), [
      t("Compte et profil : jusqu'à la suppression du compte.", "Account and profile: until the account is deleted."),
      t("Sessions : 30 jours après leur fin. Tentatives de connexion : 30 jours.", "Sessions: 30 days after they end. Sign-in attempts: 30 days."),
      t("Notifications : 90 jours après archivage, un an au plus.", "Notifications: 90 days after archiving, one year at most."),
      t("Dons : 10 ans (obligations comptables), détachés du profil après suppression du compte.", "Donations: 10 years (accounting duties), detached from the profile once the account is deleted."),
      t("Journal d'administration : conservé pour la sécurité du service.", "Administration log: kept for the security of the service."),
    ]],
    [t("Tes droits", "Your rights"), t("Accès et export (Mon compte › Mes données), rectification (ton profil), suppression (Mes données › Supprimer), opposition aux e-mails d'actualité. Pour toute question : contacte l'équipe Orbit.",
      "Access and export (My account › My data), correction (your profile), deletion (My data › Delete), objection to news e-mails. For any question: contact the Orbit team.")],
    [t("Sous-traitants", "Processors"), t("Hébergement du service et de la base de données ; Stripe pour les paiements ; un service d'e-mail pour les messages de compte.",
      "Hosting of the service and database; Stripe for payments; an e-mail service for account messages.")],
  ]);
}
