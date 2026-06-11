import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Shield } from "lucide-react";

type Mode = "login" | "register";

const RECENT_USERS_KEY = "teatro-recent-users";

function getRecentUsers(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_USERS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function addRecentUser(username: string) {
  const users = getRecentUsers().filter((u) => u !== username);
  users.unshift(username);
  localStorage.setItem(RECENT_USERS_KEY, JSON.stringify(users.slice(0, 5)));
}

function removeRecentUser(username: string) {
  const users = getRecentUsers().filter((u) => u !== username);
  localStorage.setItem(RECENT_USERS_KEY, JSON.stringify(users));
}

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recentUsers, setRecentUsers] = useState<string[]>(getRecentUsers);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentUsers(getRecentUsers());
  }, []);

  const handleSubmit = async () => {
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Preencha todos os campos.");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("Senhas não conferem.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const err = await login(username.trim(), password);
        if (err) setError(err);
        else addRecentUser(username.trim());
      } else {
        const err = await register(username.trim(), password);
        if (err) setError(err);
        else {
          setMode("login");
          setPassword("");
          setConfirmPassword("");
          setError("Conta criada! Faça login.");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const selectRecentUser = (name: string) => {
    setUsername(name);
    setPassword("");
    setError("");
    setTimeout(() => passwordRef.current?.focus(), 100);
  };

  const handleRemoveRecent = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    removeRecentUser(name);
    setRecentUsers(getRecentUsers());
  };

  const quickAdminLogin = () => {
    setUsername("admin000");
    setPassword("000");
    setError("");
    setTimeout(() => passwordRef.current?.focus(), 100);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070707] px-4">
      <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">Teatro Teleprompter</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {mode === "login" ? "Entre na sua conta" : "Crie uma nova conta"}
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        )}

        {/* Botão de login rápido ADMIN */}
        <button
          onClick={quickAdminLogin}
          className="mb-4 w-full flex items-center justify-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300 transition hover:bg-amber-500/20 hover:border-amber-500/50"
        >
          <Shield className="h-4 w-4" />
          Login Admin (admin000)
        </button>

        {/* Contas recentes para login rápido */}
        {mode === "login" && recentUsers.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Contas recentes</p>
            <div className="space-y-1">
              {recentUsers.map((name) => (
                <button
                  key={name}
                  onClick={() => selectRecentUser(name)}
                  className="group flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-black/50 px-3 py-2 text-left text-sm text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  <span>{name}</span>
                  <span
                    onClick={(e) => handleRemoveRecent(e, name)}
                    className="ml-2 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                    title="Remover"
                  >
                    X
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Usuário</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Seu nome de usuário"
              className="mt-1 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Senha</label>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              className="mt-1 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          {mode === "register" && (
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Confirmar senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                className="mt-1 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="w-full rounded-full bg-emerald-500 px-4 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </div>

        <div className="mt-6 text-center">
          {mode === "login" ? (
            <p className="text-xs text-zinc-500">
              Não tem conta?{" "}
              <button onClick={() => { setMode("register"); setError(""); }} className="text-emerald-400 hover:underline">
                Cadastre-se
              </button>
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              Já tem conta?{" "}
              <button onClick={() => { setMode("login"); setError(""); }} className="text-emerald-400 hover:underline">
                Faça login
              </button>
            </p>
          )}
        </div>

        <div className="mt-4 border-t border-zinc-800 pt-4 text-center">
          <p className="text-[10px] text-zinc-600">
            Admin: <span className="text-amber-400/70">admin000</span> / <span className="text-amber-400/70">000</span>
          </p>
        </div>
      </div>
    </main>
  );
}
