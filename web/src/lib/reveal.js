export function startReveal() {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) {
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  const scan = root => root.querySelectorAll?.("[data-reveal]:not(.in)").forEach(el => io.observe(el));
  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType == 1) {
      if (n.matches("[data-reveal]:not(.in)")) io.observe(n);
      scan(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan(document);
}
