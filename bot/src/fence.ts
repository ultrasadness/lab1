// Text from Product Hunt, its makers, a Product's site or the person reaches a model only inside a <<< >>> fence,
// under a label of ours. A run of three angle brackets in the text is spaced out, so no value can close its fence or
// open another.
export const fence = (value: string) => `<<<\n${value.trim().replace(/<{3,}|>{3,}/g, (run) => run.split('').join(' '))}\n>>>`;
