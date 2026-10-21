// Support page: donations through Stripe Checkout (when configured).
import { h, icon, t, get, post, state, act, fmtMoney, empty } from "../lib.js";

export async function page({ query }) {
  const info = await get("/donations/info");
  let amount = info.suggested[1] ?? info.suggested[0];
  let monthly = false;
  const custom = h("input", { class: "input", type: "number", min: info.min_cents / 100, max: info.max_cents / 100, step: "1", placeholder: t("Autre montant (€)", "Other amount (€)") });
  const amounts = h("div", { class: "amounts", role: "radiogroup", "aria-label": t("Montant", "Amount") });
  const labels = [t("Petit soutien", "Small support"), t("Soutien régulier", "Regular support"), t("Soutien important", "Big support"), t("Soutien majeur", "Major support")];
  const draw = () => amounts.replaceChildren(...info.suggested.map((c, i) => h("button", { type: "button", "aria-pressed": String(c == amount && !custom.value),
    onclick: () => ((amount = c), (custom.value = ""), draw()) }, fmtMoney(c, info.currency), h("div", { class: "faint small", style: { fontWeight: 400, fontSize: "11px" } }, labels[i] ?? ""))));
  draw();
  custom.addEventListener("input", () => {
    amount = Math.round(Number(custom.value) * 100);
    draw();
  });
  const kind = h("div", { class: "tabs", role: "tablist" });
  const drawKind = () => kind.replaceChildren(
    h("button", { role: "tab", "aria-selected": String(!monthly), onclick: () => ((monthly = false), drawKind()) }, t("Une fois", "Once")),
    h("button", { role: "tab", "aria-selected": String(monthly), onclick: () => ((monthly = true), drawKind()) }, t("Chaque mois", "Monthly")));
  drawKind();
  const anonymous = h("input", { type: "checkbox" });
  const pay = h("button", { class: "btn primary block", disabled: !info.enabled, onclick: async e => {
    if (!state.me) return window.orbitNavigate("/login?next=/support");
    if (!(amount >= info.min_cents && amount <= info.max_cents)) return;
    const r = await act(e.target, () => post("/donations/checkout", { amount_cents: amount, recurring: monthly, anonymous: anonymous.checked }));
    if (r?.url) location.href = r.url;
  } }, icon("heart"), t("Continuer vers le paiement", "Continue to payment"));
  return h("div", { class: "stack", style: { gap: "22px" } },
    query.thanks ? h("div", { class: "alert ok" }, icon("heart"), t("Merci ! Ton don sera confirmé dans quelques instants, dès que le paiement est validé ; ton badge arrivera à ce moment-là.",
      "Thank you! Your donation will be confirmed in a moment, once the payment clears; your badge arrives then.")) : null,
    query.canceled ? h("div", { class: "alert" }, icon("info"), t("Paiement annulé : rien n'a été prélevé.", "Payment canceled: nothing was charged.")) : null,
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, t("Soutenir Orbit", "Support Orbit")),
      h("p", {}, t("Orbit est gratuit et le restera. Les dons paient les serveurs, la signature du logiciel et le temps de développement.",
        "Orbit is free and will stay free. Donations pay for servers, code signing and development time.")))),
    h("div", { class: "grid cols-2", style: { alignItems: "start" } },
      h("section", { class: "card stack" },
        !info.enabled ? h("div", { class: "alert warn" }, icon("info"), t("Les dons ne sont pas encore ouverts : le paiement n'est pas configuré sur le serveur.",
          "Donations are not open yet: payments are not configured on the server.")) : null,
        kind, amounts, custom,
        h("label", { class: "check" }, anonymous, h("span", {}, t("Ne pas afficher mon nom parmi les donateurs", "Don't show my name among donors"))),
        pay,
        h("p", { class: "muted small", style: { margin: 0 } }, t("Paiement sécurisé par Stripe : Orbit ne voit jamais ta carte. Le soutien mensuel s'arrête quand tu veux depuis « Mes dons ». Remboursement possible sous 14 jours sur demande.",
          "Secure payment by Stripe: Orbit never sees your card. Monthly support stops whenever you want from \"My donations\". Refund possible within 14 days on request."))),
      h("section", { class: "card stack" }, h("h2", {}, t("Badges de soutien", "Support badges")),
        h("p", { class: "muted small", style: { margin: 0 } }, t("Attribués après confirmation du paiement par Stripe. Le total compte les dons nets des remboursements. Le montant n'est jamais affiché.",
          "Awarded once Stripe confirms the payment. The total counts donations net of refunds. The amount is never shown.")),
        h("div", { class: "stack", style: { gap: "8px" } },
          h("div", { class: "row between" }, h("span", {}, t("Supporter", "Supporter")), h("span", { class: "muted small" }, t("premier don", "first donation"))),
          ...info.tiers.map(tier => h("div", { class: "row between" }, h("span", { class: "row" }, h("span", { class: "badge-mini", style: { "--c": tier.color } }, icon(tier.icon)), tier.name),
            h("span", { class: "muted small" }, `${fmtMoney(tier.threshold_cents, info.currency)} ${t("au total", "in total")}`))),
          h("div", { class: "row between" }, h("span", {}, t("Monthly Supporter", "Monthly Supporter")), h("span", { class: "muted small" }, t("tant que le don mensuel est actif", "while the monthly donation is active")))),
        h("p", { class: "muted small", style: { margin: 0 } }, t("Un don ne débloque aucune fonction et ne donne aucun rôle.", "A donation unlocks no feature and grants no role.")))));
}

export { empty };
