import { LANG, t } from "./i18n.js";

export const fmtDate = d => (d ? new Intl.DateTimeFormat(LANG, { dateStyle: "medium" }).format(new Date(d)) : "");
export const fmtDateTime = d => (d ? new Intl.DateTimeFormat(LANG, { dateStyle: "medium", timeStyle: "short" }).format(new Date(d)) : "");
export const fmtMoney = (cents, cur = "eur") =>
  new Intl.NumberFormat(LANG, { style: "currency", currency: cur.toUpperCase(), ...(cents % 100 ? {} : { maximumFractionDigits: 0 }) }).format(cents / 100);
export const fmtShort = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), "day");
  return fmtDate(d);
}

export const THEME = { violet: "#7c86ff", blue: "#4f8cff", cyan: "#22c3e6", green: "#3ddc97", amber: "#f5c518", orange: "#ff9f43", rose: "#ff6bcb", red: "#ff5d5d", slate: "#8a8a99" };

export const RARITY = { common: t("Commun", "Common"), rare: t("Rare", "Rare"), epic: t("Épique", "Epic"), legendary: t("Légendaire", "Legendary"), exclusive: t("Exclusif", "Exclusive") };

const BADGES_FR = {
  founder: ["Fondateur", "A créé Orbit.", "Donné une seule fois, au propriétaire d'origine d'Orbit, à la mise en service. Il ne s'achète pas, ne se transfère pas et aucun administrateur ne peut le donner."],
  administrator: ["Administrateur", "Membre de l'équipe d'administration d'Orbit.", "Suit le rôle d'administrateur : ajouté avec lui, retiré avec lui. Le badge lui-même ne donne aucun droit."],
  moderator: ["Modérateur", "Veille sur la communauté Orbit.", "Suit le rôle de modérateur. Le badge lui-même ne donne aucun droit."],
  developer: ["Développeur", "Développeur reconnu officiellement par Orbit.", "Donné par le propriétaire aux développeurs reconnus."],
  verified: ["Vérifié", "Identité ou statut officiel vérifié par l'équipe Orbit.", "Donné après une vérification d'identité manuelle. Jamais pour un don."],
  early_supporter: ["Soutien de la première heure", "A soutenu Orbit à ses débuts.", "Un don confirmé pendant la période de lancement fixée par le propriétaire."],
  beta_tester: ["Bêta-testeur", "A participé à une bêta officielle d'Orbit.", "Participation enregistrée à une bêta officielle."],
  bug_hunter: ["Chasseur de bugs", "A signalé un bug ou une faille valide.", "Un signalement confirmé par l'équipe."],
  contributor: ["Contributeur", "A contribué de façon importante à Orbit.", "Une contribution examinée par l'équipe."],
  supporter: ["Soutien", "Soutient Orbit par un don.", "Un premier don confirmé, non remboursé en totalité."],
  supporter_bronze: ["Soutien Bronze", "Un soutien généreux pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Bronze."],
  supporter_silver: ["Soutien Argent", "Un soutien fort pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Argent."],
  supporter_gold: ["Soutien Or", "Un soutien majeur pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Or."],
  supporter_platinum: ["Soutien Platine", "Un soutien exceptionnel pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Platine."],
  supporter_monthly: ["Soutien mensuel", "Soutient Orbit chaque mois.", "Un don mensuel actif. Retiré quand il s'arrête ou n'est pas payé."],
  supporter_lifetime: ["Soutien à vie", "Un merci spécial de l'équipe Orbit.", "Donné par le propriétaire, pour un soutien dans la durée."],
};

export function localBadge(b) {
  const fr = LANG == "fr" && BADGES_FR[b.key];
  return fr ? { ...b, name: fr[0], description: fr[1], condition: fr[2] } : b;
}
