import { requireNativeView } from 'expo';
import * as React from 'react';

import { ExpoAppleIntelligenceViewProps } from './ExpoAppleIntelligence.types';

const NativeView: React.ComponentType<ExpoAppleIntelligenceViewProps> =
  requireNativeView('ExpoAppleIntelligence');

export default function ExpoAppleIntelligenceView(props: ExpoAppleIntelligenceViewProps) {
  return <NativeView {...props} />;
}
