import nodemailer from "nodemailer";

export function createMailer(cfg, log) {
  const outbox = [];
  const transport = cfg.mail.host
    ? nodemailer.createTransport({ host: cfg.mail.host, port: cfg.mail.port, secure: cfg.mail.port == 465,
      auth: cfg.mail.user ? { user: cfg.mail.user, pass: cfg.mail.pass } : undefined })
    : null;
  return {
    configured: !!transport,
    outbox,
    async send({ to, subject, text }) {
      if (!transport) {
        outbox.push({ to, subject, text });
        if (outbox.length > 50) outbox.shift();
        log.warn({ subject }, "mail not sent: SMTP is not configured");
        if (cfg.env == "development") log.info(`[dev mail to ${to}]
${text}`);
        return;
      }
      await transport.sendMail({ from: cfg.mail.from, to, subject, text });
    },
  };
}

export const MAILS = {
  verify: link => ({
    subject: "Orbit — confirme ton adresse e-mail / confirm your e-mail",
    text: `Bienvenue sur Orbit !\nConfirme ton adresse e-mail en ouvrant ce lien (valable 24 h) :\n${link}\n\n` +
      `Welcome to Orbit! Confirm your e-mail address with this link (valid 24 h):\n${link}\n\n` +
      "Si tu n'as pas créé de compte, ignore ce message. / If you did not sign up, ignore this message.",
  }),
  reset: link => ({
    subject: "Orbit — réinitialiser ton mot de passe / reset your password",
    text: `Pour choisir un nouveau mot de passe, ouvre ce lien (valable 30 min, une seule fois) :\n${link}\n\n` +
      `To choose a new password, open this link (valid 30 min, once):\n${link}\n\n` +
      "Si tu n'as rien demandé, ignore ce message : ton mot de passe ne change pas.",
  }),
  changeEmail: link => ({
    subject: "Orbit — confirme ta nouvelle adresse / confirm your new address",
    text: `Confirme ta nouvelle adresse e-mail (valable 24 h) :\n${link}\n\nConfirm your new e-mail address (valid 24 h):\n${link}`,
  }),
  security: what => ({
    subject: "Orbit — activité de sécurité / security activity",
    text: `${what}\n\nSi ce n'était pas toi, change ton mot de passe et déconnecte toutes tes sessions depuis Orbit.\n` +
      "If this was not you, change your password and sign out of every session from Orbit.",
  }),
};
