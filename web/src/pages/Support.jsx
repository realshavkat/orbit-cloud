import { useState } from "react";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { t } from "../lib/i18n.js";
import { get, post } from "../lib/api.js";
import { useMe } from "../lib/session.js";
import { fmtMoney } from "../lib/format.js";
import { Icon, Link, Liquid } from "../components/ui.jsx";
import { useBusy } from "../components/overlay.jsx";

export const loader = () => get("/donations/info");

export default function Support() {
  const info = useLoaderData();
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [amount, setAmount] = useState(info.suggested[1] ?? info.suggested[0]);
  const [custom, setCustom] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, run] = useBusy();
  const value = custom ? Math.round(Number(custom) * 100) : amount;
  const valid = value >= info.min_cents && value <= info.max_cents;
  const pay = async () => {
    if (!me) return navigate("/login?next=/support", { viewTransition: true });
    const r = await run(() => post("/donations/checkout", { amount_cents: value, recurring: monthly, anonymous }));
    if (r?.url) location.href = r.url;
  };
  return (
    <div className="stack" style={{ gap: 48 }}>
      {params.get("thanks") && <div className="alert ok"><Icon name="heart" />{t("Merci ! Ton don sera confirmé dans quelques instants, dès que le paiement est validé ; ton badge arrivera à ce moment-là.", "Thank you! Your donation will be confirmed in a moment, once the payment clears; your badge arrives then.")}</div>}
      {params.get("canceled") && <div className="alert"><Icon name="info" />{t("Paiement annulé : rien n'a été prélevé.", "Payment canceled: nothing was charged.")}</div>}
      <header className="support-head">
        <Liquid />
        <h1>{t("Soutenir Orbit", "Support Orbit")}</h1>
        <p>{t("Les dons paient les serveurs, la signature du logiciel et le temps de développement. Ils ne débloquent rien : c'est un merci.",
          "Donations pay for servers, code signing and development time. They unlock nothing: it's a thank you.")}</p>
      </header>
      <div className="support-grid">
        <section className="stack" style={{ gap: 22 }}>
          {!info.enabled && <div className="alert warn"><Icon name="info" />{t("Les dons ne sont pas encore ouverts.", "Donations are not open yet.")}</div>}
          <div className="seg" role="tablist" style={{ width: "fit-content" }}>
            <button role="tab" aria-pressed={String(!monthly)} onClick={() => setMonthly(false)}>{t("Une fois", "Once")}</button>
            <button role="tab" aria-pressed={String(monthly)} onClick={() => setMonthly(true)}>{t("Chaque mois", "Monthly")}</button>
          </div>
          <div className="amounts" role="radiogroup" aria-label={t("Montant", "Amount")}>
            {info.suggested.map(c => (
              <button key={c} type="button" role="radio" aria-checked={c == amount && !custom} aria-pressed={String(c == amount && !custom)} onClick={() => (setAmount(c), setCustom(""))}>
                {fmtMoney(c, info.currency)}{monthly && <span className="per">{t("/mois", "/mo")}</span>}
              </button>
            ))}
          </div>
          <input className="input" type="number" min={info.min_cents / 100} max={info.max_cents / 100} step="1" placeholder={t("Autre montant (€)", "Other amount (€)")}
            aria-label={t("Autre montant", "Other amount")} value={custom} onChange={e => setCustom(e.target.value)} style={{ maxWidth: 240 }} />
          <label className="check"><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} /><span>{t("Ne pas afficher mon nom parmi les donateurs", "Don't show my name among donors")}</span></label>
          <button className="btn primary big" style={{ width: "fit-content" }} disabled={!info.enabled || !valid || busy} onClick={pay}>
            <Icon name="heart" />{valid ? t(`Donner ${fmtMoney(value, info.currency)}${monthly ? " par mois" : ""}`, `Give ${fmtMoney(value, info.currency)}${monthly ? " a month" : ""}`) : t("Choisis un montant", "Pick an amount")}
          </button>
          <p className="faint small" style={{ maxWidth: "56ch" }}>{t("Paiement par Stripe : Orbit ne voit jamais ta carte. Le soutien mensuel s'arrête quand tu veux depuis ton compte. Remboursement possible sous 14 jours.",
            "Paid through Stripe: Orbit never sees your card. Monthly support stops whenever you want from your account. Refund possible within 14 days.")}</p>
        </section>
        <aside className="stack" style={{ gap: 14 }}>
          <h2 style={{ fontSize: 17 }}>{t("Badges de soutien", "Supporter badges")}</h2>
          <p className="muted small">{t("Après confirmation du paiement. Le total compte les dons, remboursements déduits. Le montant n'est jamais affiché.",
            "Once the payment is confirmed. The total counts donations, refunds deducted. The amount is never shown.")}</p>
          <div className="list">
            <div className="site-row"><span className="badge-mini" style={{ "--c": "#ff8da5" }}><Icon name="heart" /></span><span style={{ flex: 1 }}>{t("Soutien", "Supporter")}</span><span className="faint small">{t("premier don", "first donation")}</span></div>
            {info.tiers.map(tier => (
              <div key={tier.key} className="site-row"><span className="badge-mini" style={{ "--c": tier.color }}><Icon name={tier.icon} /></span>
                <span style={{ flex: 1 }}>{tier.name}</span><span className="faint small">{fmtMoney(tier.threshold_cents, info.currency)} {t("au total", "in total")}</span></div>
            ))}
            <div className="site-row"><span className="badge-mini" style={{ "--c": "#c4b5ff" }}><Icon name="calendar-heart" /></span><span style={{ flex: 1 }}>{t("Soutien mensuel", "Monthly supporter")}</span><span className="faint small">{t("tant que le don mensuel est actif", "while monthly support is on")}</span></div>
          </div>
          <div className="alert" style={{ marginTop: 10 }}><Icon name="download" /><span className="small">{t("Tu cherches le navigateur ? ", "Looking for the browser? ")}<Link className="link" to="/beta">{t("Accès à la bêta", "Beta access")}</Link></span></div>
        </aside>
      </div>
    </div>
  );
}
