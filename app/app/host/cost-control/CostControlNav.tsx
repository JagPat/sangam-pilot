export function CostControlNav({current}:{current:'overview'|'decisions'|'import'}){
  const links=[
    {key:'overview',href:'/host/cost-control',label:'Cost Control'},
    {key:'decisions',href:'/host/cost-control/decisions',label:'Decisions'},
    {key:'import',href:'/host/cost-control/import',label:'Import agreed lines'},
  ] as const;
  return <nav className="sg-costnav" aria-label="Cost Control">
    {links.map((link)=><a key={link.key} href={link.href} aria-current={current===link.key?'page':undefined}
      className={current===link.key?'is-current':undefined}>{link.label}</a>)}
  </nav>;
}
