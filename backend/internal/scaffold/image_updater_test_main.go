//go:build ignore

package scaffold

import (
	"fmt"
)

func main() {
	req := &CreateProjectRequest{
		Team:    "rocket-team",
		AppName: "golang-demo",
	}
	u := NewImageUpdater(req, "https://gitea.xeusnguyen.xyz",
		GitopsRepoURL("https://gitea.xeusnguyen.xyz", "platform-team", "wxops-gitops-infrastructure"))
	out, _ := u.Marshal()
	fmt.Println(string(out))
}
