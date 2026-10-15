import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { BookOpen, FolderOpen, LogOut, Menu, MessageSquareText, Scale, X } from "lucide-react";
import clsx from "clsx";
import { useAuth, useFeatures } from "@/features/auth/auth";
import { FeedbackButton } from "./FeedbackButton";

export function AppLayout() {
  const { user, logout } = useAuth();
  const features = useFeatures();
  const [open, setOpen] = useState(false);

  const nav = [
    { to: "/", label: "Rättsutredningar", icon: FolderOpen, end: true },
    { to: "/dokument", label: "Rättskällor", icon: BookOpen },
    ...(features.ai.ragEnabled ? [{ to: "/fraga", label: "Fråga Lawla", icon: MessageSquareText }] : []),
  ];

  return (
    <div className="flex min-h-full">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <span className="flex items-center gap-2 font-semibold">
            <Scale className="size-5 text-accent" aria-hidden /> Lawla
          </span>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Stäng meny">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                  isActive ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken hover:text-ink",
                )
              }
            >
              <Icon className="size-4" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="px-2 pb-2 text-xs text-muted">
            <div className="truncate font-medium text-ink">{user?.name || user?.email}</div>
            {user?.name && <div className="truncate">{user.email}</div>}
          </div>
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-sunken hover:text-ink"
          >
            <LogOut className="size-4" aria-hidden /> Logga ut
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Öppna meny">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">Lawla</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-8 sm:px-8">
          <Outlet />
        </main>
      </div>
      <FeedbackButton />
    </div>
  );
}
