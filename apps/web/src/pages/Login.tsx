import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch {
      setError('That email and password don’t match. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — hidden on mobile to keep the form front and centre */}
      <div className="relative hidden overflow-hidden bg-brand-900 lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-8 lg:p-12">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at 50% 40%, black, transparent 75%)',
          }}
        />
        <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
          <img src="/logo.jpeg" alt="Alken Decor Limited" className="w-full" />
        </div>
        <div className="relative max-w-md text-center">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-white text-balance">
            Every site, every shilling, in one place.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-brand-100">
            Track budgets, payments, attendance, and progress across your construction projects —
            from the office or the field.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-surface-muted px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <img
              src="/logo.jpeg"
              alt="Alken Decor Limited"
              className="mx-auto w-40 rounded-xl"
            />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-fg">Welcome back</h1>
          <p className="mt-1.5 text-sm text-fg-muted">Sign in to your account to continue.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
              />
            </Field>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-danger-hairline bg-danger-surface px-3 py-2.5 text-sm text-danger-fg"
              >
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-fg-subtle">
            Trouble signing in? Contact your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
