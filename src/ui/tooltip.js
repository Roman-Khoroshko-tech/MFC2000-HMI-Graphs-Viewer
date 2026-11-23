document.querySelectorAll('.et-tooltip').forEach(tooltip => {
  function reset(event) {
    const otherInteraction = event.type === 'mouseleave' ? ':focus-within' : ':hover';
    if (!tooltip.matches(otherInteraction)) delete tooltip.dataset.dismissed;
  }

  tooltip.addEventListener('mouseleave', reset);
  tooltip.addEventListener('focusout', reset);
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.et-tooltip:is(:hover, :focus-within)').forEach(tooltip => {
    tooltip.dataset.dismissed = '';
  });
});

