import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { t } from "../lib/i18n.js";
import { get, post } from "../lib/api.js";
import { useMe } from "../lib/session.js";
import { fmtMoney } from "../lib/format.js";
import { Icon, Link, Liquid } from "../components/ui.jsx";
import { useBusy } from "../components/overlay.jsx";

const DOWNLOAD = "https://github.com/realshavkat/orbit/releases/latest";

export const loader = () => get("/beta");

export default function Beta() {
  const b = useLoaderData();
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [busy, run] = useBusy();
  const price = fmtMoney(b.price_cents, b.currency);
  const buy = async () => {
    if (!me) return navigate("/register?next=/beta", { viewTransition: true });
    const r = await run(() => post("/beta/checkout"));
    if (r?.url) location.href = r.url;
  };
  const steps = [
    [t("Télécharge et installe Orbit", "Download and install Orbit"), t("Pour Windows 10 et 11, 64 bits.", "For Windows 10 and 11, 64-bit.")],
    [t("Connecte-toi à Firefox Sync", "Sign in to Firefox Sync"), t("Au premier lancement, avec le même compte que ton compte Orbit.", "On first launch, with the same account as your Orbit account.")],
    [t("C'est prêt", "You're in"), t("Orbit vérifie ton accès, puis fonctionne même hors ligne.", "Orbit checks your access, then works offline too.")],
  ];
  return (
    <div className="stack" style={{ gap: 56 }}>
      {params.get("thanks") && <div className="alert ok"><Icon name="circle-check" />{t("Merci ! Ton accès sera actif dans quelques instants, dès que le paiement est confirmé.", "Thank you! Your access will be active in a moment, once the payment is confirmed.")}</div>}
      {params.get("canceled") && <div className="alert"><Icon name="info" />{t("Paiement annulé : rien n'a été prélevé.", "Payment canceled: nothing was charged.")}</div>}
      <header className="beta-hero">
        <Liquid />
        <span className="kicker-line">{t("Bêta pour Windows", "Beta for Windows")}</span>
        <h1>{b.paywall ? t(`La bêta d'Orbit, ${price}.`, `The Orbit beta, ${price}.`) : t("La bêta d'Orbit est gratuite.", "The Orbit beta is free.")}</h1>
        <p>{b.paywall
          ? t("Une seule fois, pour toute la bêta. À la version 1.0, Orbit devient gratuit pour tout le monde.", "Once, for the whole beta. At version 1.0, Orbit becomes free for everyone.")
          : t("Télécharge-la et connecte-toi à Firefox Sync.", "Download it and sign in to Firefox Sync.")}</p>
        <div className="row wrap" style={{ gap: 12 }}>
          {b.owned || !b.paywall ? (
            <a className="btn accent big" href={DOWNLOAD} target="_blank" rel="noopener"><Icon name="download" />{t("Télécharger pour Windows", "Download for Windows")}</a>
          ) : (
            <button className="btn accent big" disabled={busy || !b.payments} onClick={buy}><Icon name="download" />{t(`Obtenir la bêta · ${price}`, `Get the beta · ${price}`)}</button>
          )}
          {b.owned && <span className="tag ok" style={{ height: 32 }}><Icon name="check" />{b.granted ? t("Accès offert par l'équipe", "Access given by the team") : t("Accès acheté", "Access purchased")}</span>}
        </div>
        {b.paywall && !b.payments && !b.owned && <p className="faint small">{t("Le paiement ouvre bientôt.", "Payment opens soon.")}</p>}
      </header>
      <section className="steps-3">
        {steps.map(([title, text], i) => (
          <div key={i} className="step-3"><span className="n">{i + 1}</span><h3>{title}</h3><p>{text}</p></div>
        ))}
      </section>
      <section className="faq">
        <h2>{t("Questions", "Questions")}</h2>
        <dl className="facts">
          <div><dt>{t("Pourquoi payant ?", "Why paid?")}</dt><dd>{t("La bêta finance la signature du logiciel et les serveurs. Le prix reste symbolique.", "The beta pays for code signing and servers. The price stays symbolic.")}</dd></div>
          <div><dt>{t("Et après la bêta ?", "And after the beta?")}</dt><dd>{t("Orbit devient gratuit pour tous. Ton badge Bêta-testeur reste.", "Orbit becomes free for everyone. Your Beta tester badge stays.")}</dd></div>
          <div><dt>{t("Remboursement", "Refund")}</dt><dd>{t("Sur demande sous 14 jours ; l'accès est alors retiré.", "On request within 14 days; access is then removed.")}</dd></div>
          <div><dt>{t("Plusieurs PC", "Several PCs")}</dt><dd>{t("Oui : connecte chaque PC au même compte Firefox Sync.", "Yes: sign each PC in to the same Firefox Sync account.")}</dd></div>
        </dl>
      </section>
      {!me && <p className="muted">{t("Déjà un compte ? ", "Already have an account? ")}<Link className="link" to="/login?next=/beta">{t("Se connecter", "Sign in")}</Link></p>}
    </div>
  );
}
