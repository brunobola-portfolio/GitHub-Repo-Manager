export function getGreeting(date, name) {
    const hour = date.getHours()
    let phrase
    if (hour >= 6 && hour < 12) phrase = 'Bom dia'
    else if (hour >= 12 && hour < 18) phrase = 'Boa tarde'
    else phrase = 'Boa noite'

    if (!name) return phrase
    return `${phrase}, ${name}`
}
