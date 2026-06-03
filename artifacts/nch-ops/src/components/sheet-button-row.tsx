/**
 * SheetButtonRow — universal action bar for bottom sheets, modals, and forms.
 *
 * RULE: Every sheet/modal/form action bar MUST use this component so buttons
 * are always positioned above the bottom navigation bar, even when the iOS
 * keyboard is open or the iPhone home indicator is present.
 *
 * Usage:
 *   <SheetButtonRow>
 *     <Button variant="outline" className="flex-1">Cancel</Button>
 *     <Button className="flex-1">Save</Button>
 *   </SheetButtonRow>
 *
 * - sticky bottom-0  → stays at the bottom of the nearest scroll container
 * - padding-bottom   → clears nav bar (64px) + iPhone safe area inset
 * - bg-background    → covers content scrolling beneath it
 */

export function SheetButtonRow({
  children,
  className,
  border = false,
}: {
  children: React.ReactNode;
  className?: string;
  border?: boolean;
}) {
  return (
    <div
      className={`sticky bottom-0 bg-background pt-3 px-4 ${
        border ? "border-t border-border" : ""
      } ${className ?? ""}`}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)" }}
    >
      <div className="flex gap-3">{children}</div>
    </div>
  );
}
