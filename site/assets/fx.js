// Small page effects shared by the hazptr.github.io pages: cards tilt towards the pointer, buttons
// lean towards it, and sections fade in as they scroll into view.
(() => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  function tilt(el) {
    if (still || !finePointer) return;
    const max = Number(el.dataset.tilt || 10);
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      el.style.setProperty('--rx', `${(0.5 - py) * max}deg`);
      el.style.setProperty('--ry', `${(px - 0.5) * max}deg`);
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  }

  function magnetic(el) {
    if (still || !finePointer) return;
    const strength = Number(el.dataset.magnetic || 0.3);
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left - rect.width / 2) * strength;
      const y = (e.clientY - rect.top - rect.height / 2) * strength;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  }

  const reveal = still
    ? null
    : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          reveal.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });

  // Elements added later (fetched cards) call Fx.apply on their container
  function apply(root = document) {
    root.querySelectorAll('[data-tilt]').forEach(tilt);
    root.querySelectorAll('[data-magnetic]').forEach(magnetic);
    root.querySelectorAll('.reveal').forEach((el, i) => {
      el.style.setProperty('--delay', `${Math.min(i, 8) * 60}ms`);
      if (reveal) reveal.observe(el);
      else el.classList.add('is-visible');
    });
  }

  window.Fx = { apply };
  document.addEventListener('DOMContentLoaded', () => apply());
})();
