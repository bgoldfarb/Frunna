// Reexport the native module. On web, it will be resolved to ExpoAppleIntelligenceModule.web.ts
// and on native platforms to ExpoAppleIntelligenceModule.ts
export { default } from './src/ExpoAppleIntelligenceModule';
export { default as ExpoAppleIntelligenceView } from './src/ExpoAppleIntelligenceView';
export * from  './src/ExpoAppleIntelligence.types';
