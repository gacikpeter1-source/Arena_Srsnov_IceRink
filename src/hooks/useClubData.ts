import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Club, DivisionRule, Rink, TimeSlotConfig, Zone } from '@/types'

const CLUB_ID = import.meta.env.VITE_CLUB_ID

interface ClubData {
  club: Club | null
  rinks: Rink[]
  zones: Zone[]
  // One config per rink — index by rinkId, not a single shared config.
  timeSlotConfigs: TimeSlotConfig[]
  divisionRules: DivisionRule[]
  loading: boolean
  error: string | null
}

export function useClubData(): ClubData {
  const [club, setClub] = useState<Club | null>(null)
  const [rinks, setRinks] = useState<Rink[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [timeSlotConfigs, setTimeSlotConfigs] = useState<TimeSlotConfig[]>([])
  const [divisionRules, setDivisionRules] = useState<DivisionRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const clubSnap = await getDoc(doc(db, 'clubs', CLUB_ID))
        if (!clubSnap.exists()) {
          setError(`No club configured for id "${CLUB_ID}"`)
          setLoading(false)
          return
        }
        setClub({ id: clubSnap.id, ...clubSnap.data() } as Club)

        const rinksSnap = await getDocs(
          query(collection(db, 'rinks'), where('clubId', '==', CLUB_ID), where('active', '==', true))
        )
        setRinks(
          rinksSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Rink)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        )

        const zonesSnap = await getDocs(
          query(collection(db, 'zones'), where('clubId', '==', CLUB_ID), where('active', '==', true))
        )
        setZones(
          zonesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Zone)
            .sort((a, b) => a.slotIndex - b.slotIndex)
        )

        const configSnap = await getDocs(
          query(collection(db, 'timeSlotConfig'), where('clubId', '==', CLUB_ID))
        )
        setTimeSlotConfigs(configSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimeSlotConfig))

        const rulesSnap = await getDocs(
          query(collection(db, 'divisionRules'), where('clubId', '==', CLUB_ID))
        )
        setDivisionRules(rulesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as DivisionRule))
      } catch (err) {
        console.error('Error loading club data:', err)
        setError('Failed to load club configuration')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { club, rinks, zones, timeSlotConfigs, divisionRules, loading, error }
}
