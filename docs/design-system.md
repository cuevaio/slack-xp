# Portal Messenger Design System

Portal Messenger uses the visual language of early-2000s desktop software. The
system should feel deliberate and cohesive, not like a loose collection of
retro effects. All implementation tokens live in `src/app/globals.css`.

## Foundations

Feature components should use semantic Tailwind utilities such as `bg-primary`,
`text-muted-foreground`, and `border-border`. The legacy names (`--navy`,
`--paper`, and similar) are temporary aliases during the CSS migration. New
component code should use semantic names.

## Rules

1. Use semantic tokens in components. Never add hex, RGB, HSL, or OKLCH values
   outside the primitive palette in `:root`.
2. Use `Button`, `Input`, `Textarea`, `Badge`, `Alert`, and `DropdownMenu` from
   `src/components/ui` before creating component-specific controls.
3. Do not use React `style` attributes. Use a class and a token. Dynamic geometry
   is the only exception and must use a documented CSS custom property.
4. Use the 4px spacing grid. Prefer Tailwind's standard spacing utilities or the
   `--space-*` variables. Do not introduce values such as `7px`, `13px`, or
   `0.9rem` for padding, margin, or gap.
5. Borders communicate depth. Use `--border-width-thin` for separators,
   `--border-width-medium` for controls and raised surfaces,
   `--border-width-thick` for dialogs, and `--border-width-accent` only for
   emphasis.
6. Corners stay compact. Use square corners by default, `--radius-compact` for
   menu items and highlights, `--radius-avatar` for avatars,
   `--radius-floating` sparingly, and `--radius-full` only for dots or circular
   badges.
7. Decorative art, responsive breakpoints, and fixed application-window
   dimensions may use bespoke dimensions. Interactive component geometry may
   not.

Run `bun run design:check` before shipping UI changes.

## Color Roles

| Role | Token | Usage |
| --- | --- | --- |
| Desktop | `--background` | Desktop canvas only |
| Ink | `--foreground` | Default text |
| Paper | `--card` | Message and document surfaces |
| Chrome | `--secondary` | Window chrome and default controls |
| Muted | `--muted`, `--muted-foreground` | Disabled surfaces and secondary text |
| Primary | `--primary`, `--primary-foreground` | Title bars and primary actions |
| Accent | `--accent`, `--accent-foreground` | Selected and informational surfaces |
| Warning | `--warning`, `--warning-foreground` | Attention without failure |
| Destructive | `--destructive`, `--destructive-foreground` | Errors and irreversible actions |
| Success | `--success`, `--success-foreground` | Online and completed states |
| Focus | `--ring` | Keyboard focus only |
| Border | `--border`, `--border-subtle`, `--border-strong` | Structure and depth |

Primitive colors such as `--color-blue-500` exist to define semantic roles and
intentional illustrations. Product components should prefer the semantic role.

## Spacing

The base unit is 4px. The supported sequence is 1, 2, 4, 6, 8, 10, 12, 14,
16, 20, 24, 32, 40, 48, 64, and 96px. In Tailwind, use the matching standard
utilities such as `gap-2`, `p-3`, and `mt-6`. In CSS, use `--space-px` through
`--space-24`.

Use tighter spacing inside a control and wider spacing between groups. A useful
default is 8px inside compact controls, 12px inside ordinary controls, 16px
between related groups, and 24-32px between sections.

## Sizing

| Size | Token | Pixels | Usage |
| --- | --- | --- | --- |
| Extra small | `--control-xs` | 28px | Dense toolbar control |
| Small | `--control-sm` | 32px | Compact control |
| Medium | `--control-md` | 36px | Default desktop control |
| Large | `--control-lg` | 44px | Prominent or touch control |

Use 36px avatars by default, 28px in dense lists, and 40px only when identity is
the primary content. Mobile interactive targets must be at least 44px.

## Components

Import primitives from `@/components/ui/*`.

- `Button`: classic beveled control by default. Use `primary` for the single
  main action and `destructive` for irreversible actions.
- `Input` and `Textarea`: inset white work surfaces with shared focus and
  invalid states.
- `Label`: consistent field typography and disabled behavior. Always connect it
  with `htmlFor` and an input `id`.
- `Badge`: compact status metadata. Use `warning` for attention, not errors.
- `Alert`: system feedback. Use `destructive` only when the user needs to
  correct or retry something.
- `DropdownMenu`: compact, trigger-originated floating actions. Use it instead
  of building a bespoke action menu.

Pass `className` for layout concerns such as width, alignment, or placement. Add
visual variants to the primitive instead of overriding colors in feature code.

## Borders And Radius

Raised XP surfaces use a light top/left edge and dark bottom/right edge. Pressed
surfaces invert those edges. Do not combine that treatment with large rounded
corners or soft modern shadows.

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-none` | 0 | Windows, inputs, buttons, cards |
| `--radius-compact` | 2px | Selection and menu-item highlight |
| `--radius-avatar` | 3px | Avatars and compact indicators |
| `--radius-floating` | 4px | Floating action groups only |
| `--radius-full` | Full | Status dots and count badges |

## Motion

Motion exists for feedback, not decoration. Pressable controls scale to `0.97`
for `--duration-press` with `--ease-out`. Menus enter from `0.95` opacity/scale
and originate from their trigger. Frequently repeated keyboard actions do not
animate. Only transition `transform`, `opacity`, `filter`, or color properties,
and honor `prefers-reduced-motion`.

## Adding Components

Install shadcn components with Bun, then apply the Portal Messenger treatment
in the generated source:

```sh
bunx --bun shadcn@latest docs <component>
bunx --bun shadcn@latest add <component> --yes
```

Run focused checks after editing:

```sh
bunx biome check src/components/ui/<component>.tsx
bun run design:check
```

## Review Checklist

| Before | After | Why |
| --- | --- | --- |
| One-off color literal | Semantic color token | Keeps roles consistent and themeable |
| `padding: 0.7rem` | `padding: var(--space-3)` | Keeps layout on the 4px grid |
| `border: 2px` chosen ad hoc | Named border-width token | Makes depth predictable |
| `border-radius: 8px` | Square or compact radius token | Preserves the XP visual language |
| Custom component button | Shared `Button` variant | Centralizes states, sizing, and focus |
| `transition: all` | Explicit transition properties | Avoids accidental layout animation |
