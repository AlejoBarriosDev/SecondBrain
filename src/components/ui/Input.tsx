"use client";

import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function Input({
  label,
  hint,
  id,
  className = "",
  ...props
}: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={id}
          className="sb-text-secondary text-xs font-medium tracking-wide"
        >
          {label}
        </label>
      ) : null}
      <input
        id={id}
        className={`sb-input h-10 w-full rounded-xl border px-3 text-sm transition-colors ${className}`}
        {...props}
      />
      {hint ? <p className="sb-text-muted text-xs">{hint}</p> : null}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

export function Select({
  label,
  hint,
  id,
  className = "",
  children,
  ...props
}: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={id}
          className="sb-text-secondary text-xs font-medium tracking-wide"
        >
          {label}
        </label>
      ) : null}
      <select
        id={id}
        className={`sb-input h-10 w-full rounded-xl border px-3 text-sm transition-colors ${className}`}
        {...props}
      >
        {children}
      </select>
      {hint ? <p className="sb-text-muted text-xs">{hint}</p> : null}
    </div>
  );
}

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export function Textarea({
  label,
  hint,
  id,
  className = "",
  ...props
}: TextareaProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={id}
          className="sb-text-secondary text-xs font-medium tracking-wide"
        >
          {label}
        </label>
      ) : null}
      <textarea
        id={id}
        className={`sb-input w-full rounded-xl border p-3 text-sm transition-colors ${className}`}
        {...props}
      />
      {hint ? <p className="sb-text-muted text-xs">{hint}</p> : null}
    </div>
  );
}
