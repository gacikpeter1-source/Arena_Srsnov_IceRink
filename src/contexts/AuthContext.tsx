import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { StaffUser } from '@/types'

const CLUB_ID = import.meta.env.VITE_CLUB_ID

interface AuthContextValue {
  user: User | null
  staff: StaffUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [staff, setStaff] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const staffSnap = await getDoc(doc(db, 'staff', firebaseUser.uid))
        setStaff(staffSnap.exists() ? (staffSnap.data() as StaffUser) : null)
      } else {
        setStaff(null)
      }
      setLoading(false)
    })
  }, [])

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
  }

  // Self-registration: anyone can create an account, but it starts as
  // 'pending' with no permissions — an owner or superadmin has to grant a
  // real role before it can do anything (see firestore.rules). Sets the
  // context's staff state directly rather than relying on the
  // onAuthStateChanged listener to re-fetch, since that listener's own
  // getDoc could otherwise race this doc's creation.
  const signup = async (email: string, password: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const newStaff: StaffUser = {
      uid: cred.user.uid,
      clubId: CLUB_ID,
      email,
      name,
      role: 'pending',
      createdAt: new Date()
    }
    await setDoc(doc(db, 'staff', cred.user.uid), newStaff)
    setStaff(newStaff)
  }

  const logout = async () => {
    await signOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, staff, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
