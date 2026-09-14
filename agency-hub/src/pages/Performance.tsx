import { BarChart3 } from 'lucide-react'
import PerformanceArea from '../components/performance/PerformanceArea'

export default function Performance() {
  return (
    <div>
      <div className="page-header">
        <h1><BarChart3 size={20} style={{ marginRight: 8, verticalAlign: -3 }} /> Performance</h1>
      </div>
      <PerformanceArea />
    </div>
  )
}
