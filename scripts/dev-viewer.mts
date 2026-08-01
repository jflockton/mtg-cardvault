// Dev helper: serve the inventory viewer against ./data without launching
// the Electron app. Usage: npx tsx scripts/dev-viewer.mts
import { DataStore } from '../src/main/store'
import { openInventoryViewer } from '../src/main/viewer'

const store = new DataStore(process.env.MTG_CARDVAULT_DATA_DIR ?? 'data')
const url = await openInventoryViewer(store)
console.log(`viewer: ${url}`)
