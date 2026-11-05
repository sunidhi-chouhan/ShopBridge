import { createContext, useContext, useState, type ReactNode } from "react";

type Tone = "success" | "error";

type ToastItem = {
  id: number;
  tone: Tone;
  message: string;
};

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function useToast(): (message: string, tone?: Tone) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function push(message: string, tone: Tone = "success") {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4000);
  }

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <p key={item.id} className={`toast toast-${item.tone}`} role="status">
            {item.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
