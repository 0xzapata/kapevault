// The copy-ready erasure request for "Request deletion". Generic on purpose: it names two rights and
// makes no other legal claim (no deadlines, no penalties). The sheet says it is a template, not
// legal advice. Pure, so it runs under `node --test`.

export interface ErasureEmail {
  subject: string;
  body: string;
}

interface ErasureInput {
  service: string; // the item's title: "Mock Shop"
  account: string; // username or email on that account; "" if none saved
  website: string; // "" if none saved
}

export function erasureEmail({ service, account, website }: ErasureInput): ErasureEmail {
  const details = [account && `Account: ${account}`, website && `Website: ${website}`].filter(Boolean);
  const body = [
    "Hello,",
    `I am asking you to delete my ${service} account and the personal data you hold about me.`,
    ...(details.length ? [details.join("\n")] : []),
    "I make this request under my right to erasure in Article 17 of the EU General Data Protection Regulation (GDPR), and my right to have my personal data erased or blocked in Section 16(e) of the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).",
    "Please close the account, delete my personal data, and reply to confirm once it is done.",
    "Thank you.",
  ].join("\n\n");
  return { subject: `Request to delete my account and personal data - ${service}`, body };
}

// What "Copy email" puts on the clipboard: the subject line, then the body.
export const emailText = ({ subject, body }: ErasureEmail) => `Subject: ${subject}\n\n${body}`;
