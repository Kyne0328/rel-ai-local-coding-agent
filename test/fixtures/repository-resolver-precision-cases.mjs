const RESOLVER_PRECISION_CASES = Object.freeze([
  { language:'python', path:'src/api.py', fakeImport:'fake/pkg', realImport:'real/pkg', source:'note = "from fake.pkg import Nope"\nfrom real.pkg import Real\n@app.get("/users")\ndef users():\n    return requests.post("https://api.example.com/v1/users")\n', relations:[['HANDLES','GET /users'],['HTTP_CALLS','POST https://api.example.com/v1/users']] },
  { language:'java', path:'src/Controller.java', fakeImport:'fake/Bad', realImport:'real/Base', source:'import real.Base;\nclass Controller { String note = "import fake.Bad;"; @GetMapping("/users") void users() {} }', relations:[['HANDLES','GET /users']] },
  { language:'csharp', path:'src/Controller.cs', fakeImport:'Fake/Bad', realImport:'Acme/Real', source:'using Real = Acme.Real;\nclass Controller { string note = "using Fake = Fake.Bad;"; [HttpGet("/users")] void Users() {} }', relations:[['HANDLES','GET /users']] },
  { language:'go', path:'src/api.go', fakeImport:'fake/pkg', realImport:'example.com/acme/real', source:'package api\nimport real "example.com/acme/real"\nfunc Users() { note := `import fake "fake/pkg"`; _ = note; router.GET("/users", Users); http.Get("https://api.example.com/v1/users") }', relations:[['HANDLES','GET /users'],['HTTP_CALLS','GET https://api.example.com/v1/users']] },
  { language:'rust', path:'src/lib.rs', fakeImport:'fake/pkg', realImport:'real', source:'use crate::real::Thing;\n// use fake::pkg::Nope;\nfn run() { let note = "use fake::pkg::Nope;"; Thing::new(); }', relations:[] },
  { language:'cpp', path:'src/main.cpp', fakeImport:'./fake.hpp', realImport:'./real.hpp', source:'#include "real.hpp"\nconst char* note = R"(#include "fake.hpp")";\nint main(){ return 0; }', relations:[] },
  { language:'php', path:'src/Controller.php', fakeImport:'Fake/Bad', realImport:'Acme/Real', source:'<?php\nuse Acme\\Real;\n$note = "use Fake\\Bad;";\nRoute::get("/users", fn() => 1);', relations:[['HANDLES','GET /users']] },
  { language:'kotlin', path:'src/Controller.kt', fakeImport:'fake/Bad', realImport:'com/acme/Real', source:'import com.acme.Real\nval note = "import fake.Bad"\nclass Controller {\n    @GetMapping("/users")\n    fun users(): Int { return 1 }\n}', relations:[['HANDLES','GET /users']] },
  { language:'ruby', path:'lib/app.rb', fakeImport:'./fake', realImport:'./real', source:'require_relative "./real"\nnote = %q{require_relative "./fake"}\nget "/users" do\n  1\nend\n', relations:[['HANDLES','GET /users']] }
]);

export { RESOLVER_PRECISION_CASES };
