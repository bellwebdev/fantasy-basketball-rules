// Pending-amendments page: keeps the header tallies honest and highlights the
// category the reader is currently sitting in.

const sections = [...document.querySelectorAll("main .rule[id]")];
const links = new Map(
  [...document.querySelectorAll(".toc a[href^='#']")].map((link) => [
    link.hash.slice(1),
    link,
  ]),
);

/* Counts are derived from the markup so they can't drift out of sync. */
const setCount = (key, value) => {
  const target = document.querySelector(`[data-count="${key}"]`);
  if (target) target.textContent = value;
};

setCount("proposals", document.querySelectorAll(".proposal").length);
setCount("categories", sections.length);

/* Scroll-spy: mark the section closest to the top of the viewport. */
if (sections.length > 0) {
  const visible = new Set();

  const paint = () => {
    const active =
      sections.find((section) => visible.has(section.id)) ?? sections[0];

    links.forEach((link, id) =>
      link.classList.toggle("current", id === active.id),
    );
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(({ target, isIntersecting }) =>
        isIntersecting ? visible.add(target.id) : visible.delete(target.id),
      );
      requestAnimationFrame(paint);
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );

  sections.forEach((section) => observer.observe(section));
}
