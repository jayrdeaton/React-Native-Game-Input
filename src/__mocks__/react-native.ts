// useTilt only reads Platform.OS. Tests set it per case (native or web); the real module is Flow
// source that this ts-jest-only config can't load.
export const Platform: { OS: 'ios' | 'android' | 'web' } = { OS: 'ios' }
