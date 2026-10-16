// Why: the accent comes from the theme tokens in globals.css, so every primary button in the
// app changes together. The focus ring uses the same accent, with the lighter one on dark.
export const primaryButtonClass =
  "inline-flex w-fit items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-accent-soft";

export const secondaryButtonClass =
  "inline-flex w-fit items-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:border-neutral-700 dark:hover:bg-neutral-900 dark:focus-visible:outline-accent-soft";

// Why: one text field look for the whole app. The focus ring is the accent, drawn as an
// outline so it stays visible in Windows high contrast mode, where box shadows are removed.
export const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent dark:border-neutral-700 dark:bg-neutral-950 dark:focus-visible:outline-accent-soft";

// Why: one surface for every panel, so the home, chat and admin pages share one look and a
// change to radius, border or dark colour is a one line edit. Padding is left to each use.
export const cardClass =
  "rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900";
