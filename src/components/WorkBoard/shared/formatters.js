/**
 * Formatting helpers shared across Work Board tabs + KPI row.
 */

export function ageLabel(hours) {
    if (hours == null) return '—'
    if (hours < 1) return 'just now'
    if (hours < 24) return `${Math.round(hours)}h old`
    return `${Math.round(hours / 24)}d old`
}

export function dayLabel(days) {
    if (days == null) return '—'
    if (days < 1) return 'today'
    return `${Math.round(days)}d old`
}

export function hoursLabel(h) {
    if (h == null) return '—'
    if (h < 1) return `${Math.round(h * 60)}m`
    if (h < 48) return `${Math.round(h)}h`
    return `${Math.round(h / 24)}d`
}
