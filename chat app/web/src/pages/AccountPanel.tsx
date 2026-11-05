import { useState } from "react";
import type { PublicUser } from "../../../shared/types";
import { loadLanguagePrefs, saveLanguagePrefs, type LanguagePrefs } from "../chat/languagePrefs";
import { syncNexconnTranslationLanguage } from "../chat/translate";
import { chatCredentials } from "../api";
import { connectSaathi } from "../chat/nexconn";
import { LanguageBar } from "../conversation/LanguageBar";
import { copy } from "../copy";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { roleLabel } from "../ui/nav";
import { useRequestSignOut } from "../components/Shell";

export function AccountPanel({ user }: { user: PublicUser }) {
  const requestSignOut = useRequestSignOut();
  const role = roleLabel(user.role);
  const [prefs, setPrefs] = useState<LanguagePrefs>(() => loadLanguagePrefs(user.id));
  const [notice, setNotice] = useState<string | null>(null);

  async function onPrefsChange(next: LanguagePrefs) {
    setPrefs(next);
    saveLanguagePrefs(user.id, next);
    setNotice(null);
    try {
      const credentials = await chatCredentials();
      await connectSaathi(credentials.appKey, credentials.token, credentials.userId);
      await syncNexconnTranslationLanguage(next.targetLanguage);
      setNotice(`Reading language set to ${next.targetLanguage}. Used when you open order rooms.`);
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Preference saved locally. Sync with Nexconn failed — enable Console Translation if needed.",
      );
    }
  }

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
          <div>
            <dt>Name</dt>
            <dd>{user.name}</dd>
          </div>
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
          <div>
            <dt>Session</dt>
            <dd>Kept in this browser for ShopBridge until you sign out.</dd>
          </div>
          {user.sample ? (
            <div>
              <dt>Account</dt>
              <dd>Sample</dd>
            </div>
          ) : null}
        </dl>
        <div className="account-language">
          <h3 className="account-language-title">Conversation language</h3>
          <LanguageBar prefs={prefs} onChange={(next) => void onPrefsChange(next)} />
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
