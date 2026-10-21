import { t } from "../lib/i18n.js";

function Doc({ title, updated, sections }) {
  return (
    <article className="legal" style={{ margin: "0 auto" }}>
      <h1>{title}</h1>
      <p className="faint small" style={{ marginTop: 8 }}>{updated}</p>
      {sections.map(([heading, ...paras]) => (
        <section key={heading}>
          <h2>{heading}</h2>
          {paras.map((p, i) => (Array.isArray(p) ? <ul key={i}>{p.map(x => <li key={x}>{x}</li>)}</ul> : <p key={i}>{p}</p>))}
        </section>
      ))}
    </article>
  );
}

const UPDATED = t("Version du 21 octobre 2026", "Version of 21 October 2026");

export const Terms = () => (
  <Doc title={t("Conditions d'utilisation", "Terms of use")} updated={UPDATED} sections={[
    [t("Le service", "The service"), t("Le compte Orbit donne accès à la communauté (profil, badges, amis, collections, mods) et, pendant la bêta, au navigateur lui-même.",
      "An Orbit account gives access to the community (profile, badges, friends, collections, mods) and, during the beta, to the browser itself.")],
    [t("Bêta payante", "Paid beta"), t("Pendant la bêta, l'accès au navigateur Orbit coûte un petit montant, payé une seule fois. Il devient gratuit pour tout le monde à la version 1.0. Un remboursement peut être demandé sous 14 jours ; il retire l'accès à la bêta.",
      "During the beta, access to the Orbit browser costs a small amount, paid once. It becomes free for everyone at version 1.0. A refund can be requested within 14 days; it removes beta access.")],
    [t("Ton compte", "Your account"), t("Un compte par personne. Tu es responsable de ton mot de passe ; active la validation en deux étapes. Un pseudo qui imite Orbit, son équipe ou une autre personne est interdit.",
      "One account per person. You are responsible for your password; turn on two-step verification. A username imitating Orbit, its team or another person is forbidden.")],
    [t("Contenu et mods", "Content and mods"), t("Interdits : harcèlement, spam, contenu illégal, haineux ou sexuel explicite, usurpation d'identité, code malveillant. Chaque mod est vérifié avant publication. Les modérateurs peuvent masquer un contenu, retirer un mod, suspendre les fonctions communautaires ou un compte ; tu peux contester une décision depuis ton compte.",
      "Forbidden: harassment, spam, illegal, hateful or sexually explicit content, impersonation, malicious code. Every mod is checked before it is listed. Moderators may hide content, remove a mod, suspend community features or an account; you can appeal a decision from your account.")],
    ["Badges", t("Les badges récompensent des critères réels. Ils ne s'achètent pas, ne se transfèrent pas et ne donnent aucun droit.", "Badges reward real criteria. They cannot be bought or transferred and grant no rights.")],
    [t("Dons", "Donations"), t("Les dons sont volontaires et ne débloquent aucune fonction. Le soutien mensuel s'arrête à tout moment ; un don remboursé ou contesté ne compte plus pour les badges.",
      "Donations are voluntary and unlock no feature. Monthly support can stop at any time; a refunded or disputed donation no longer counts toward badges.")],
    [t("Fin du compte", "Closing your account"), t("Tu peux supprimer ton compte à tout moment. Orbit peut suspendre un compte qui enfreint ces conditions.", "You can delete your account at any time. Orbit may suspend an account that breaks these terms.")],
  ]} />
);

export const Privacy = () => (
  <Doc title={t("Politique de confidentialité", "Privacy policy")} updated={UPDATED} sections={[
    [t("Ce que nous collectons", "What we collect"), [
      t("Compte : pseudo, adresse e-mail, mot de passe (haché, jamais lisible) ou identifiant de ton compte Mozilla.", "Account: username, e-mail address, password (hashed, never readable) or your Mozilla account identifier."),
      t("Profil : ce que tu y écris et les images que tu envoies.", "Profile: what you write and the images you upload."),
      t("Sécurité : sessions (adresse IP, navigateur), tentatives de connexion (30 jours).", "Security: sessions (IP address, browser), sign-in attempts (30 days)."),
      t("Communauté : amis, blocages, signalements, notifications, sites, collections et mods que tu partages.", "Community: friends, blocks, reports, notifications, sites, collections and mods you share."),
      t("Paiements : montant, date, statut et références Stripe. Jamais ta carte bancaire.", "Payments: amount, date, status and Stripe references. Never your card."),
    ]],
    [t("Ce que nous ne collectons pas", "What we don't collect"), t("Ni ton historique, ni tes onglets, ni tes favoris, ni ta navigation privée. Le navigateur n'envoie un site que si tu cliques sur « Partager ce site » : seulement son nom de domaine. La vérification de l'accès bêta n'envoie que ton identifiant de compte.",
      "Not your history, tabs, bookmarks or private browsing. The browser sends a site only when you click \"Share this site\": just its domain name. The beta access check only sends your account identifier.")],
    [t("Visibilité", "Visibility"), t("Chaque élément de ton profil a son réglage de visibilité, appliqué par le serveur. L'adresse e-mail n'est jamais publique. Un site partagé n'affiche ses membres qu'à partir de trois personnes.",
      "Each part of your profile has its own visibility setting, enforced by the server. Your e-mail is never public. A shared site only lists its members from three people.")],
    [t("Durées de conservation", "Retention"), [
      t("Compte et profil : jusqu'à la suppression du compte.", "Account and profile: until the account is deleted."),
      t("Sessions : 30 jours après leur fin. Tentatives de connexion : 30 jours.", "Sessions: 30 days after they end. Sign-in attempts: 30 days."),
      t("Notifications : 90 jours après archivage, un an au plus.", "Notifications: 90 days after archiving, one year at most."),
      t("Paiements : 10 ans (obligations comptables), détachés du profil après suppression du compte.", "Payments: 10 years (accounting duties), detached from the profile once the account is deleted."),
    ]],
    [t("Tes droits", "Your rights"), t("Accès et export (Mon compte › Mes données), rectification (ton profil), suppression (Mes données › Supprimer), opposition aux e-mails d'actualité.",
      "Access and export (Account › My data), correction (your profile), deletion (My data › Delete), objection to news e-mails.")],
    [t("Sous-traitants", "Processors"), t("Hébergement du service et de la base de données ; Stripe pour les paiements ; Mozilla pour la connexion avec Firefox Sync ; un service d'e-mail pour les messages de compte.",
      "Hosting of the service and database; Stripe for payments; Mozilla for signing in with Firefox Sync; an e-mail service for account messages.")],
  ]} />
);
