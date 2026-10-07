/** A stable ref callback: focus (and select) the field when it first appears. */
export function focusOnMount(el: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!el) return;
  el.focus();
  el.select();
}
