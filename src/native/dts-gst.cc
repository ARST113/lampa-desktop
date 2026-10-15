#include <node_api.h>
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <atomic>
#include <string>
#include <vector>

// GStreamer is loaded as a native library. This module opens no listening ports.
namespace {
struct Packet { std::vector<unsigned char> pcm; };
struct Session {
  GstElement *pipeline=nullptr;
  napi_threadsafe_function tsfn=nullptr;
  std::atomic<unsigned long long> bytes{0};
  std::atomic<unsigned long long> dropped{0};
};
Session* active=nullptr;
bool gst_ready=false;
void error(napi_env e,const char* msg){napi_throw_error(e,nullptr,msg);}
void deliver(napi_env env,napi_value callback,void*,void* data){
  Packet* p=static_cast<Packet*>(data);
  if(env && callback){
    napi_value global,buffer;
    napi_get_global(env,&global);
    if(napi_create_buffer_copy(env,p->pcm.size(),p->pcm.data(),nullptr,&buffer)==napi_ok)
      napi_call_function(env,global,callback,1,&buffer,nullptr);
  }
  delete p;
}
GstFlowReturn on_sample(GstAppSink* sink,gpointer opaque){
  Session* s=static_cast<Session*>(opaque);
  GstSample* sample=gst_app_sink_pull_sample(sink);
  if(!sample) return GST_FLOW_EOS;
  GstBuffer* b=gst_sample_get_buffer(sample);
  GstMapInfo map;
  if(b && gst_buffer_map(b,&map,GST_MAP_READ)){
    Packet* p=new Packet;
    p->pcm.assign(map.data,map.data+map.size);
    s->bytes.fetch_add(map.size);
    gst_buffer_unmap(b,&map);
    if(napi_call_threadsafe_function(s->tsfn,p,napi_tsfn_nonblocking)!=napi_ok){
      s->dropped.fetch_add(1);
      delete p;
    }
  }
  gst_sample_unref(sample);
  return GST_FLOW_OK;
}
void dispose(Session* s){
  if(!s)return;
  if(s->pipeline){gst_element_set_state(s->pipeline,GST_STATE_NULL);gst_object_unref(s->pipeline);}
  if(s->tsfn)napi_release_threadsafe_function(s->tsfn,napi_tsfn_release);
  delete s;
}
napi_value stop(napi_env env,napi_callback_info){
  Session* s=active;active=nullptr;dispose(s);
  napi_value val;napi_get_undefined(env,&val);return val;
}
napi_value start(napi_env env,napi_callback_info info){
  size_t argc=3; napi_value argv[3];
  napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr);
  if(argc!=3){error(env,"Expected source, audio ordinal, PCM callback");return nullptr;}
  size_t n=0;
  if(napi_get_value_string_utf8(env,argv[0],nullptr,0,&n)!=napi_ok||n==0||n>8192){
    error(env,"Invalid stream URL");return nullptr;
  }
  std::string src(n+1,'\0');
  napi_get_value_string_utf8(env,argv[0],&src[0],src.size(),&n);src.resize(n);
  int32_t audio=-1;napi_valuetype kind;
  if(napi_get_value_int32(env,argv[1],&audio)!=napi_ok||audio<0||audio>63){
    error(env,"Invalid Matroska audio ordinal");return nullptr;
  }
  if(napi_typeof(env,argv[2],&kind)!=napi_ok||kind!=napi_function){
    error(env,"PCM callback required");return nullptr;
  }
  bool http=g_str_has_prefix(src.c_str(),"http://")||g_str_has_prefix(src.c_str(),"https://");
  bool file=src[0]=='/';
#ifdef _WIN32
  file=file||(src.size()>2&&src[1]==':');
#endif
  if(!http&&!file){error(env,"Only HTTP(S) or absolute file paths permitted");return nullptr;}
  if(!gst_ready){
    GError* err=nullptr;
    if(!gst_init_check(nullptr,nullptr,&err)){
      std::string msg=err?err->message:"GStreamer init failed";
      if(err)g_error_free(err);error(env,msg.c_str());return nullptr;
    }
    gst_ready=true;
  }
  stop(env,nullptr);
  Session* s=new Session;
  napi_value label;napi_create_string_utf8(env,"lampa-gstreamer-dts",NAPI_AUTO_LENGTH,&label);
  if(napi_create_threadsafe_function(env,argv[2],nullptr,label,64,1,
      nullptr,nullptr,nullptr,deliver,&s->tsfn)!=napi_ok){
    delete s;error(env,"Cannot initialize native PCM bridge");return nullptr;
  }
  // Source is assigned as a GObject property. No pipeline string injection.
  // audio/x-dts enforces DTS-only input.
  std::string pipe=std::string(http?"souphttpsrc":"filesrc")+
    " name=src ! matroskademux name=demux demux.audio_"+std::to_string(audio)+
    " ! queue ! audio/x-dts ! decodebin ! audioconvert ! audioresample "
    " ! audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved "
    " ! appsink name=pcm sync=false emit-signals=false max-buffers=16";
  GError* err=nullptr;
  s->pipeline=gst_parse_launch(pipe.c_str(),&err);
  if(err||!s->pipeline){
    std::string msg=err?err->message:"Failed to parse DTS pipeline";
    if(err)g_error_free(err);dispose(s);error(env,msg.c_str());return nullptr;
  }
  GstElement* source=gst_bin_get_by_name(GST_BIN(s->pipeline),"src");
  GstElement* output=gst_bin_get_by_name(GST_BIN(s->pipeline),"pcm");
  if(!source||!output){
    if(source)gst_object_unref(source);
    if(output)gst_object_unref(output);
    dispose(s);error(env,"Required GStreamer plugins are missing");return nullptr;
  }
  g_object_set(G_OBJECT(source),"location",src.c_str(),nullptr);
  GstAppSinkCallbacks callbacks{};callbacks.new_sample=on_sample;
  gst_app_sink_set_callbacks(GST_APP_SINK(output),&callbacks,s,nullptr);
  gst_object_unref(source);gst_object_unref(output);
  if(gst_element_set_state(s->pipeline,GST_STATE_PLAYING)==GST_STATE_CHANGE_FAILURE){
    dispose(s);error(env,"Could not start DTS decoder");return nullptr;
  }
  active=s;
  napi_value ok;napi_get_boolean(env,true,&ok);return ok;
}
napi_value pause_audio(napi_env env,napi_callback_info info){
  size_t n=1;napi_value a[1];napi_get_cb_info(env,info,&n,a,nullptr,nullptr);
  bool paused=false;
  if(n!=1||!active||napi_get_value_bool(env,a[0],&paused)!=napi_ok){
    error(env,"Invalid pause request");return nullptr;
  }
  GstStateChangeReturn status=gst_element_set_state(active->pipeline,
    paused?GST_STATE_PAUSED:GST_STATE_PLAYING);
  napi_value ok;napi_get_boolean(env,status!=GST_STATE_CHANGE_FAILURE,&ok);return ok;
}
napi_value seek(napi_env env,napi_callback_info info){
  size_t n=1;napi_value a[1];napi_get_cb_info(env,info,&n,a,nullptr,nullptr);
  double sec=-1;
  if(n!=1||!active||napi_get_value_double(env,a[0],&sec)!=napi_ok||
     !(sec>=0&&sec<604800)){error(env,"Invalid seek");return nullptr;}
  bool result=gst_element_seek_simple(active->pipeline,GST_FORMAT_TIME,
    (GstSeekFlags)(GST_SEEK_FLAG_FLUSH|GST_SEEK_FLAG_KEY_UNIT),(gint64)(sec*GST_SECOND));
  napi_value ok;napi_get_boolean(env,result,&ok);return ok;
}
napi_value stats(napi_env env,napi_callback_info){
  napi_value object,value;napi_create_object(env,&object);
  napi_create_double(env,active?(double)active->bytes.load():0,&value);
  napi_set_named_property(env,object,"bytes",value);
  napi_create_double(env,active?(double)active->dropped.load():0,&value);
  napi_set_named_property(env,object,"dropped",value);
  napi_get_boolean(env,active!=nullptr,&value);
  napi_set_named_property(env,object,"running",value);
  return object;
}
void cleanup(void*){Session* s=active;active=nullptr;dispose(s);}
napi_value init(napi_env env,napi_value exports){
  napi_property_descriptor properties[]={
    {"start",nullptr,start,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"stop",nullptr,stop,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"seek",nullptr,seek,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"pause",nullptr,pause_audio,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"stats",nullptr,stats,nullptr,nullptr,nullptr,napi_default,nullptr}
  };
  napi_define_properties(env,exports,5,properties);
  napi_add_env_cleanup_hook(env,cleanup,nullptr);
  return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
