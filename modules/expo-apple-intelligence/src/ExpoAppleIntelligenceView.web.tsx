import * as React from 'react';

import { ExpoAppleIntelligenceViewProps } from './ExpoAppleIntelligence.types';

export default function ExpoAppleIntelligenceView(props: ExpoAppleIntelligenceViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
