import { Ic } from '../components/Icons';

const allUsers = [
  { name: '王小明', email: 'wang@s.edu',  role: 'student', courses: 4, queries: 31, joined: '2024-02-10' },
  { name: '林美玲', email: 'lin@s.edu',   role: 'student', courses: 3, queries: 22, joined: '2024-02-11' },
  { name: '陳建國', email: 'chen@s.edu',  role: 'teacher', courses: 2, queries: 0,  joined: '2024-01-15' },
  { name: '張雅婷', email: 'chang@s.edu', role: 'student', courses: 5, queries: 45, joined: '2024-02-08' },
  { name: '李文志', email: 'lee@s.edu',   role: 'teacher', courses: 3, queries: 0,  joined: '2024-01-20' },
  { name: '黃俊傑', email: 'huang@s.edu', role: 'student', courses: 2, queries: 8,  joined: '2024-03-01' },
];

export default function AdminUsers() {
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>User Management</div>
        <button className="btn-primary" style={{ padding: '9px 20px', fontSize: 12 }}><Ic n="plus" s={13} />新增用戶</button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="ff-tbl">
          <thead>
            <tr><th>USER</th><th>EMAIL</th><th>ROLE</th><th>COURSES</th><th>QUERIES</th><th>JOINED</th></tr>
          </thead>
          <tbody>
            {allUsers.map((u, i) => (
              <tr key={i}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: u.role === 'teacher' ? 'rgba(74,222,128,0.2)' : 'rgba(165,180,252,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: u.role === 'teacher' ? '#4ade80' : '#a5b4fc', fontFamily: "'Space Grotesk',sans-serif" }}>
                      {u.name[0]}
                    </div>
                    {u.name}
                  </div>
                </td>
                <td style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12 }}>{u.email}</td>
                <td><span className={`badge ${u.role === 'teacher' ? 'bg' : 'bb'}`}>{u.role === 'teacher' ? '教師' : '學生'}</span></td>
                <td>{u.courses}</td>
                <td>{u.queries || '—'}</td>
                <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>{u.joined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
