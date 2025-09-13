
import Link from "next/link";
export default function HomePage() {
  return (<div className="card">
    <h1>College Alumni Fantasy</h1>
    <p>Weekly fantasy points by <b>college</b> from pro players.</p>
    <p className="badge">FantasyNerds MVP</p>
    <p style={{ marginTop: 16 }}><Link className="btn" href="/schools">Browse Schools</Link></p>
    <p style={{ marginTop: 8 }}><Link className="btn" href="/rankings">Rankings</Link></p>
    <p style={{ marginTop: 8 }}><Link className="btn" href="/matchups">Simulate Matchups</Link></p>
    <p style={{ marginTop: 8 }}><Link className="btn" href="/standings">Standings</Link></p>
    <div className="footer">Set <small className="code">FANTASYNERDS_API_KEY</small> in <small className="code">.env.local</small>.</div>
  </div>);
}
