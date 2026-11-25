"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Fingerprint, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { FeedbackBanner, type FeedbackMessage } from "@/components/ui/FeedbackBanner";

export function LoginClient({ initialError }: { initialError?: string | null }) {
  const router = useRouter();
  const [loadingProvider, setLoadingProvider] = useState<
    "google" | "passkey" | null
  >(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(
    initialError
      ? {
          type: "error",
          text:
            initialError === "FORBIDDEN"
              ? "Acceso restringido únicamente a la cuenta personal autorizada."
              : `No se pudo iniciar sesión: ${initialError}`,
        }
      : null,
  );

  const handleGoogleSignIn = async () => {
    setFeedback(null);
    setLoadingProvider("google");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      if (result?.error) {
        setFeedback({
          type: "error",
          text:
            result.error.message ||
            "Error al iniciar sesión con Google. Verifica que tu cuenta esté autorizada.",
        });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Error inesperado al conectar con Google.",
      });
    } finally {
      setLoadingProvider(null);
    }
  };

  const handlePasskeySignIn = async () => {
    setFeedback(null);
    setLoadingProvider("passkey");
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        setFeedback({
          type: "error",
          text:
            result.error.message ||
            "No se pudo verificar tu Passkey / Biometría.",
        });
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Tu navegador o dispositivo canceló la autenticación con Passkey.",
      });
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="absolute top-4 right-4">
        <ThemeToggle showLabel />
      </div>

      <div className="sb-surface w-full max-w-md rounded-3xl border p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
            <Brain className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="sb-text-primary text-2xl font-bold tracking-tight">
            SecondBrain
          </h1>
          <p className="sb-text-secondary mt-1.5 text-sm">
            Personal Life OS · Centro de Comando Financiero
          </p>
        </div>

        {feedback ? (
          <div className="mb-5">
            <FeedbackBanner
              message={feedback}
              onDismiss={() => setFeedback(null)}
            />
          </div>
        ) : null}

        <div className="space-y-3">
          <Button
            variant="primary"
            size="lg"
            loading={loadingProvider === "google"}
            disabled={loadingProvider !== null}
            onClick={handleGoogleSignIn}
            className="w-full"
          >
            <span>Continuar con Google</span>
          </Button>

          <Button
            variant="secondary"
            size="lg"
            loading={loadingProvider === "passkey"}
            disabled={loadingProvider !== null}
            onClick={handlePasskeySignIn}
            className="w-full"
          >
            <Fingerprint className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            <span>Iniciar con Passkey / Biometría</span>
          </Button>
        </div>

        <div className="sb-elevated mt-6 flex items-start gap-2.5 rounded-xl border p-3.5 text-xs">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
            aria-hidden="true"
          />
          <p className="sb-text-secondary leading-relaxed">
            Uso personal exclusivo. Solo el correo autorizado en{" "}
            <code className="font-mono text-[11px]">ALLOWED_EMAIL</code> puede
            acceder y vincular Passkeys WebAuthn desde Ajustes.
          </p>
        </div>
      </div>
    </main>
  );
}
