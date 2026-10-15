import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Scale } from "lucide-react";
import { Button, ErrorNote, Input, Label } from "@/components/ui";
import { useAuth, useFeatures } from "./auth";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const features = useFeatures();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(params.get("error") === "google" ? new Error("Google-inloggningen avbröts.") : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (user) return <Navigate to={from} replace />;

  const canRegister = features.security.allowRegistrations;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") {
        await login({ email, password });
        navigate(from, { replace: true });
      } else {
        const pending = await register({ email, password, name });
        if (pending) {
          setNotice(pending);
          setMode("login");
        } else navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden flex-col justify-between bg-accent p-12 text-accent-ink lg:flex">
        <div className="flex items-center gap-2.5 text-lg font-semibold">
          <Scale className="size-6" aria-hidden /> Lawla
        </div>
        <div className="max-w-md">
          <h1 className="font-serif text-4xl leading-tight">Från klientens berättelse till en underbyggd rättsutredning.</h1>
          <p className="mt-4 text-base opacity-80">
            Strukturera ärendet, formulera rättsfrågorna, knyt dem till lag och praxis och låt AI ta fram analysutkast du kan granska.
          </p>
        </div>
        <p className="text-xs opacity-60">Koppars Consulting</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="font-serif text-2xl">{mode === "login" ? "Logga in" : "Skapa konto"}</h2>
            <p className="mt-1 text-sm text-muted">{mode === "login" ? "Välkommen tillbaka." : "Ange dina uppgifter."}</p>
          </div>

          {notice && <p className="rounded-md bg-accent-soft p-3 text-sm text-accent">{notice}</p>}
          {error != null && <ErrorNote error={error} />}

          {mode === "register" && (
            <div>
              <Label htmlFor="name">Namn</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </div>
          )}
          <div>
            <Label htmlFor="email">E-post</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password">Lösenord</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 8 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          <Button type="submit" className="w-full" loading={busy}>
            {mode === "login" ? "Logga in" : "Skapa konto"}
          </Button>

          {features.googleAuth.enabled && (
            <a
              href="/auth/google"
              className="flex h-10 w-full items-center justify-center rounded-md border border-line bg-surface text-sm font-medium hover:bg-sunken"
            >
              Fortsätt med Google
            </a>
          )}

          {canRegister && (
            <p className="text-center text-sm text-muted">
              {mode === "login" ? "Saknar du konto? " : "Har du redan konto? "}
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError(null);
                }}
              >
                {mode === "login" ? "Skapa konto" : "Logga in"}
              </button>
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
