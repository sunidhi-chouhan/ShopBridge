import { useState } from "react";
import { useSession } from "../app/session";
import { LanguageBar } from "../conversation/LanguageBar";
import { copy } from "../copy";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { roleLabel } from "../ui/nav";
import { useRequestSignOut } from "../components/Shell";

export function AccountPanel() {
  const { user, language, autoTranslate, setLanguage, setAutoTranslate } = useSession();
  const requestSignOut = useRequestSignOut();
  const role = roleLabel(user.role);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className="account-page" aria-label="Account">
      <header className="page-mast">
        <p className="kicker">Your desk</p>
        <h1 className="page-title">Account.</h1>
      </header>
      <Card variant="profile" className="profile-card">
        <div className="profile-ident">
          <Avatar name={user.name} />
          <div>
            <h2>{user.name}</h2>
            <Badge tone="accent">{role}</Badge>
          </div>
        </div>
        <dl className="profile-facts">
          {user.email ? (
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
          ) : null}
          <div>
            <dt>Role</dt>
            <dd>{role}</dd>
          </div>
          {user.sample ? (
            <div>
              <dt>Account</dt>
              <dd>Shared demo account</dd>
            </div>
          ) : null}
        </dl>
        <div className="account-language">
          <h3 className="account-language-title">Conversation language</h3>
          <LanguageBar
            uiLanguage={language}
            language={language}
            autoTranslate={autoTranslate}
            onLanguage={(next) => {
              setNotice(null);
              setLanguage(next)
                .then(() => setNotice("Saved. Every conversation now reads in this language."))
                .catch(() => setNotice("Could not save your language. Try again."));
            }}
            onAutoTranslate={setAutoTranslate}
          />
          {notice ? (
            <p className="meta" role="status">
              {notice}
            </p>
          ) : null}
        </div>
        <Button variant="secondary" onClick={requestSignOut}>
          {copy.signOut}
        </Button>
      </Card>
    </section>
  );
}
