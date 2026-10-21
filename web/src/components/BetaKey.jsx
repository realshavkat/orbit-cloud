import { useState } from "react";
import { t } from "../lib/i18n.js";
import { Icon } from "./ui.jsx";

export function BetaKey({ value, devices, max }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="beta-key">
      <code>{value}</code>
      <button className="btn small" type="button" onClick={() => (navigator.clipboard?.writeText(value), setCopied(true), setTimeout(() => setCopied(false), 2000))}>
        <Icon name={copied ? "check" : "copy"} />{copied ? t("Copiée", "Copied") : t("Copier", "Copy")}
      </button>
      {max != null && <span className="faint small">{t(`${devices} / ${max} appareils`, `${devices} / ${max} devices`)}</span>}
    </div>
  );
}
