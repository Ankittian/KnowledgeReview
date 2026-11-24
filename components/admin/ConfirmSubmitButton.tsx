"use client";

/** A submit button that asks "are you sure?" first (native confirm); used for delete / switch actions inside a form. */
export function ConfirmSubmitButton({ message, className, children, ...rest }: { message: string; className?: string; children: React.ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick">) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
