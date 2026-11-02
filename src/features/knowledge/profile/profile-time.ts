export const profileTimeZone = 'Asia/Shanghai';
export const profileDay = (date: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: profileTimeZone }).format(new Date(date));
