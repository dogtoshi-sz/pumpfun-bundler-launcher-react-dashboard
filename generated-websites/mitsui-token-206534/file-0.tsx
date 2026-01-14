@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(0.98 0 0);
  --foreground: oklch(0.15 0 0);
  --card: oklch(0.98 0 0);
  --card-foreground: oklch(0.15 0 0);
  --popover: oklch(0.98 0 0);
  --popover-foreground: oklch(0.15 0 0);
  --primary: oklch(0.65 0.22 270);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.55 0.18 220);
  --secondary-foreground: oklch(0.98 0 0);
  --muted: oklch(0.25 0.01 270);
  --muted-foreground: oklch(0.65 0.02 270);
  --accent: oklch(0.75 0.19 280);
  --accent-foreground: oklch(0.98 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.98 0 0);
  --border: oklch(0.3 0.02 270);
  --input: oklch(0.3 0.02 270);
  --ring: oklch(0.65 0.22 270);
  --chart-1: oklch(0.65 0.22 270);
  --chart-2: oklch(0.55 0.18 220);
  --chart-3: oklch(0.75 0.19 280);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --radius: 0.75rem;
  --sidebar: oklch(0.98 0 0);
  --sidebar-foreground: oklch(0.15 0 0);
  --sidebar-primary: oklch(0.65 0.22 270);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.95 0 0);
  --sidebar-accent-foreground: oklch(0.15 0 0);
  --sidebar-border: oklch(0.3 0.02 270);
  --sidebar-ring: oklch(0.65 0.22 270);
}

.dark {
  --background: oklch(0.08 0.01 270);
  --foreground: oklch(0.98 0 0);
  --card: oklch(0.12 0.015 270);
  --card-foreground: oklch(0.98 0 0);
  --popover: oklch(0.12 0.015 270);
  --popover-foreground: oklch(0.98 0 0);
  --primary: oklch(0.65 0.22 270);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.55 0.18 220);
  --secondary-foreground: oklch(0.98 0 0);
  --muted: oklch(0.18 0.02 270);
  --muted-foreground: oklch(0.65 0.02 270);
  --accent: oklch(0.75 0.19 280);
  --accent-foreground: oklch(0.98 0 0);
  --destructive: oklch(0.55 0.2 25);
  --destructive-foreground: oklch(0.98 0 0);
  --border: oklch(0.18 0.02 270);
  --input: oklch(0.18 0.02 270);
  --ring: oklch(0.65 0.22 270);
  --chart-1: oklch(0.65 0.22 270);
  --chart-2: oklch(0.55 0.18 220);
  --chart-3: oklch(0.75 0.19 280);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.1 0.01 270);
  --sidebar-foreground: oklch(0.98 0 0);
  --sidebar-primary: oklch(0.65 0.22 270);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.18 0.02 270);
  --sidebar-accent-foreground: oklch(0.98 0 0);
  --sidebar-border: oklch(0.18 0.02 270);
  --sidebar-ring: oklch(0.65 0.22 270);
}

@theme inline {
  --font-sans: "Geist", "Geist Fallback";
  --font-mono: "Geist Mono", "Geist Mono Fallback";
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
