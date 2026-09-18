import React from 'react';
import {reportClientError} from './errorMonitoring.js';

export class ErrorBoundary extends React.Component {
  state={error:null};
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error,info){reportClientError(error,{source:'react-boundary',componentStack:info.componentStack});}
  render(){
    if(!this.state.error)return this.props.children;
    return <main className="fatalError" role="alert"><div><h1>O MedHora encontrou um problema</h1><p>Seus dados continuam salvos. Atualize a página para tentar novamente.</p><button className="primary" onClick={()=>location.reload()}>Atualizar página</button><small>Código: {this.state.error.name||'APP_ERROR'}</small></div></main>;
  }
}
