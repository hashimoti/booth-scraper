import AppView from "./components/AppView";
import { useOutfitManager } from "./hooks/useOutfitManager";

function App() {
  const app = useOutfitManager();

  return <AppView {...app} />;
}

export default App;
