// Timed presentation of an already planned journey. No live schedule is inferred.
export function clockText(minute){
  const rounded = Math.round(minute);
  const day = Math.floor(rounded / 1440);
  const time = ((rounded % 1440) + 1440) % 1440;
  return `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}${day > 0 ? ` +${day}d` : ''}`;
}

export function durationText(minute){
  const min = Math.max(0, Math.round(minute));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

export function buildTimeline(option, departureMinute){
  const rows = [];
  let elapsed = 0;
  const consumedExits = new Set();
  const point = (kind, stop, offset, leg = null) => {
    const row = { type: 'point', kind, stop, offset: Math.round(offset), clock: clockText(departureMinute + offset), leg };
    rows.push(row);
    return row;
  };
  point('origin', null, 0);
  option.legs.forEach((leg, index) => {
    if (leg.type === 'walk'){
      const next = option.legs[index + 1];
      const exit = next?.type === 'ride' ? next.exitMin || 0 : 0;
      if (exit) consumedExits.add(next);
      const minutes = (leg.travelMinutes ?? leg.m * 1.3 / 75) + exit;
      if (leg.m >= 15 || exit) rows.push({ type: 'walk', leg, minutes, exit, from: elapsed, to: elapsed + minutes, index });
      elapsed += minutes;
      return;
    }
    const transfer = leg.transferMinutes || 0;
    const exit = consumedExits.has(leg) ? 0 : leg.exitMin || 0;
    const wait = leg.wait || 0;
    if (wait + transfer + exit > 0){
      rows.push({ type: 'wait', leg, minutes: wait + transfer + exit, wait, transfer, exit, from: elapsed, to: elapsed + wait + transfer + exit });
      elapsed += wait + transfer + exit;
    }
    point('board', leg.route.stops[leg.from], elapsed, leg);
    const minutes = leg.travelMinutes || 0;
    let stopOffset = elapsed;
    const intermediate = [];
    for (let pos = leg.from + 1; pos < leg.to; pos++){
      stopOffset += leg.segmentMinutes?.[pos - leg.from - 1] || 0;
      intermediate.push({ stop: leg.route.stops[pos], offset: stopOffset, clock: clockText(departureMinute + stopOffset) });
    }
    rows.push({ type: 'ride', leg, minutes, from: elapsed, to: elapsed + minutes, intermediate });
    elapsed += minutes;
    point('alight', leg.route.stops[leg.to], elapsed, leg);
  });
  // The planner rounds the whole trip once, rather than each displayed segment.
  point('destination', null, option.minutes);
  return { rows, minutes: option.minutes, calculatedMinutes: elapsed };
}
