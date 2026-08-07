import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Club, TimeSlotConfig, Zone } from '@/types'

const CLUB_ID = import.meta.env.VITE_CLUB_ID

interface ClubData {
  club: Club | null
  zones: Zone[]
  timeSlotConfig: TimeSlotConfig | null
  loading: boolean
  error: string | null
}

export function useClubData(): ClubData {
  const [club, setClub] = useState<Club | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [timeSlotConfig, setTimeSlotConfig] = useState<TimeSlotConfig | null>(null)
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

        const zonesSnap = await getDocs(
          query(collection(db, 'zones'), where('clubId', '==', CLUB_ID), where('active', '==', true))
        )
        setZones(
          zonesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Zone)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        )

        const configSnap = await getDocs(
          query(collection(db, 'timeSlotConfig'), where('clubId', '==', CLUB_ID))
        )
        if (!configSnap.empty) {
          const d = configSnap.docs[0]
          setTimeSlotConfig({ id: d.id, ...d.data() } as TimeSlotConfig)
        }
      } catch (err) {
        console.error('Error loading club data:', err)
        setError('Failed to load club configuration')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { club, zones, timeSlotConfig, loading, error }
}
