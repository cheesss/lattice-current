/**
 * EventFlowSankeyPanel.ts — 이벤트→테마→바스켓→종목 Sankey 흐름도
 *
 * 이벤트가 어떤 경로를 통해 종목 반응으로 이어지는지 시각화.
 */

import { Panel } from './Panel';
import { renderSankeyFlow } from '@/utils/d3-sankey-flow';
import type { SankeyFlowNode, SankeyFlowLink } from '@/utils/d3-sankey-flow';

export class EventFlowSankeyPanel extends Panel {
  private containerId: string;

  constructor() {
    super({ id: 'event-flow-sankey', title: 'Event → Asset Flow' });
    this.containerId = `event-flow-chart-${Date.now()}`;
    this.content.innerHTML = `<div id="${this.containerId}" style="width:100%;height:100%;min-height:300px"></div>`;
  }

  public setData(nodes: SankeyFlowNode[], links: SankeyFlowLink[]): void {
    const container = document.getElementById(this.containerId);
    if (!container) return;
    const rect = container.getBoundingClientRect();

    renderSankeyFlow({
      containerId: this.containerId,
      nodes,
      links,
      width: Math.max(rect.width, 500),
      height: Math.max(rect.height, 300),
    });

    this.setCount(links.length);
  }
}
